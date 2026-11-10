require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, 'private_uploads');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet({ 
  contentSecurityPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" } 
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
const sessionMiddleware = session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'development-only-change-me',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${require('crypto').randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(allowed.includes(file.mimetype) ? null : new Error('Only JPG, PNG or WEBP images are allowed.'), allowed.includes(file.mimetype));
  }
});

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireAuth = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Please sign in.' });
const requireRole = (...roles) => (req, res, next) => {
  if (!req.session.user || !roles.includes(req.session.user.role)) return res.status(403).json({ error: 'Not permitted.' });
  next();
};
const log = (actor, action, target, metadata = {}) => pool.query(
  'INSERT INTO audit_logs(actor_id,action,target_user_id,metadata) VALUES($1,$2,$3,$4)',
  [actor, action, target, metadata]
);

/* ---------------- AUTH ---------------- */
app.post('/api/register', upload.fields([{ name: 'nid', maxCount: 1 }, { name: 'vehiclePhoto', maxCount: 1 }, { name: 'profilePhoto', maxCount: 1 }]), asyncRoute(async (req, res) => {
  const { role, name, mobile, email, password, present_address, permanent_address, nid_number, registration_number, make_model, vehicle_type, color, details } = req.body;
  if (!['customer', 'driver'].includes(role)) return res.status(400).json({ error: 'Choose customer or driver.' });
  if (!name || !mobile || !password || password.length < 10 || !nid_number || !req.files?.nid?.[0]) {
    return res.status(400).json({ error: 'Name, mobile, 10-character password, NID number and NID image are required.' });
  }
  if (role === 'driver' && (!registration_number || !make_model || !vehicle_type || !req.files?.vehiclePhoto?.[0])) {
    return res.status(400).json({ error: 'Driver vehicle details and vehicle photo are required.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, 12);
    const inserted = await client.query(
      `INSERT INTO users(role,name,mobile,email,password_hash,present_address,permanent_address,nid_number,nid_file,profile_photo)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [role, name, mobile, email || null, hash, present_address || null, permanent_address || null, nid_number, req.files.nid[0].filename, req.files.profilePhoto?.[0]?.filename || null]
    );
    if (role === 'driver') await client.query(
      `INSERT INTO vehicles(driver_id,registration_number,make_model,vehicle_type,vehicle_size,color,details,photo_file)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [inserted.rows[0].id, registration_number, make_model, vehicle_type, req.body.vehicle_size || null, color || null, details || null, req.files.vehiclePhoto[0].filename]
    );
    await client.query('COMMIT');
    res.status(201).json({ message: 'Registration submitted. Your account is pending admin approval.' });
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}));

app.post('/api/login', asyncRoute(async (req, res) => {
  const { mobile, password } = req.body;
  const { rows } = await pool.query('SELECT id,role,name,mobile,password_hash,status FROM users WHERE mobile=$1', [mobile]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid mobile number or password.' });
  if (user.status === 'pending') return res.status(403).json({ error: 'Your account is awaiting admin approval.' });
  if (user.status !== 'approved') return res.status(403).json({ error: 'This account is not active. Contact support.' });
  req.session.user = { id: user.id, role: user.role, name: user.name, mobile: user.mobile };
  res.json({ user: req.session.user });
}));
app.post('/api/logout', asyncRoute(async (req, res) => { if (req.session.user?.role === 'driver') await pool.query('UPDATE users SET is_online=FALSE,current_lat=NULL,current_lng=NULL WHERE id=$1', [req.session.user.id]); req.session.destroy(() => res.json({ message: 'Signed out.' })); }));
app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.session.user }));

/* ---------------- FEATURE (i): CHANGE PASSWORD ---------------- */
app.post('/api/change-password', requireAuth, asyncRoute(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Current and new password are required.' });
  if (String(new_password).length < 10) return res.status(400).json({ error: 'New password must be at least 10 characters.' });
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.session.user.id]);
  if (!rows[0] || !(await bcrypt.compare(current_password, rows[0].password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  const hash = await bcrypt.hash(new_password, 12);
  await pool.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.session.user.id]);
  await log(req.session.user.id, 'password_changed', req.session.user.id);
  res.json({ message: 'Password updated successfully.' });
}));

/* ---------------- ADMIN ---------------- */
app.get('/api/admin/stats', requireRole('admin'), asyncRoute(async (_req, res) => {
  const q = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM rides) AS total_bookings,
      (SELECT COUNT(*)::int FROM rides WHERE status='completed') AS completed_rides,
      (SELECT COUNT(*)::int FROM users WHERE role='customer' AND status='approved') AS active_users,
      (SELECT COUNT(*)::int FROM users WHERE role='driver' AND status='approved') AS active_drivers,
      (SELECT COALESCE(SUM(final_fare),0)::numeric(12,2) FROM rides WHERE status='completed') AS gross_ride_value,
      (SELECT COUNT(*)::int FROM rides WHERE status='cancelled') AS cancellations
  `);
  res.json(q.rows[0]);
}));
app.get('/api/admin/users', requireRole('admin'), asyncRoute(async (req, res) => {
  const role = ['customer', 'driver', 'admin'].includes(req.query.role) ? req.query.role : null;
  const { rows } = await pool.query(
    `SELECT id,role,name,mobile,email,present_address,permanent_address,nid_number,status,created_at
     FROM users WHERE ($1::text IS NULL OR role=$1) ORDER BY created_at DESC LIMIT 300`, [role]);
  res.json({ users: rows });
}));
app.get('/api/admin/users/:id/details', requireRole('admin'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id,u.role,u.name,u.mobile,u.email,u.present_address,u.permanent_address,
           u.nid_number,u.nid_file,u.status,u.created_at,u.updated_at,
           v.id AS vehicle_id,v.registration_number,v.make_model,v.vehicle_type,v.vehicle_size,
           v.color,v.details AS vehicle_details,v.photo_file,v.status AS vehicle_status
    FROM users u LEFT JOIN vehicles v ON v.driver_id=u.id
    WHERE u.id=$1 AND u.role IN ('customer','driver')`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
  const u = rows[0];
  res.json({
    user: {
      ...u, nid_url: u.nid_file ? `/api/admin/users/${u.id}/document/nid` : null,
      vehicle_photo_url: u.photo_file ? `/api/admin/users/${u.id}/document/vehicle` : null
    }
  });
}));
app.get('/api/admin/users/:id/document/:kind', requireRole('admin'), asyncRoute(async (req, res) => {
  const kind = req.params.kind;
  if (!['nid', 'vehicle'].includes(kind)) return res.status(400).send('Invalid document type.');
  const { rows } = await pool.query(`SELECT u.nid_file,v.photo_file
    FROM users u LEFT JOIN vehicles v ON v.driver_id=u.id
    WHERE u.id=$1 AND u.role IN ('customer','driver')`, [req.params.id]);
  if (!rows[0]) return res.status(404).send('Account not found.');
  const filename = kind === 'nid' ? rows[0].nid_file : rows[0].photo_file;
  if (!filename) return res.status(404).send('Document not available.');
  const safeName = path.basename(filename);
  const fullPath = path.join(uploadDir, safeName);
  if (!fs.existsSync(fullPath)) return res.status(404).send('Document file not found.');
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(fullPath);
}));
app.patch('/api/admin/users/:id', requireRole('admin'), asyncRoute(async (req, res) => {
  const { status, name, mobile, email, present_address, permanent_address, nid_number,
    registration_number, make_model, vehicle_type, vehicle_size, color, vehicle_details, vehicle_status } = req.body;
  const allowed = ['pending', 'approved', 'rejected', 'blocked'];
  const vehicleAllowed = ['pending', 'approved', 'rejected'];
  if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Invalid account status.' });
  if (vehicle_status && !vehicleAllowed.includes(vehicle_status)) return res.status(400).json({ error: 'Invalid vehicle status.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE users SET name=COALESCE($1,name),mobile=COALESCE($2,mobile),email=COALESCE($3,email),
       present_address=COALESCE($4,present_address),permanent_address=COALESCE($5,permanent_address),nid_number=COALESCE($6,nid_number),
       status=COALESCE($7,status),updated_at=NOW()
       WHERE id=$8 AND role <> 'admin' RETURNING id,role,name,mobile,email,status`,
      [name?.trim() || null, mobile?.trim() || null, email?.trim() || null, present_address ?? null,
      permanent_address ?? null, nid_number?.trim() || null, status || null, req.params.id]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Account not found or cannot be edited here.' }); }
    if (rows[0].role === 'driver') {
      await client.query(`UPDATE vehicles SET
        registration_number=COALESCE($1,registration_number),make_model=COALESCE($2,make_model),
        vehicle_type=COALESCE($3,vehicle_type),vehicle_size=COALESCE($4,vehicle_size),color=COALESCE($5,color),details=COALESCE($6,details),status=COALESCE($7,status)
        WHERE driver_id=$8`, [registration_number?.trim() || null, make_model?.trim() || null,
      vehicle_type?.trim() || null, vehicle_size ?? null, color ?? null, vehicle_details ?? null, vehicle_status || null, req.params.id]);
    }
    await client.query('COMMIT');
    await log(req.session.user.id, 'admin_updated_user', req.params.id, req.body);
    res.json({ user: rows[0] });
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}));
app.delete('/api/admin/users/:id', requireRole('admin'), asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query(`DELETE FROM users WHERE id=$1 AND role <> 'admin'`, [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Account not found.' });
  await log(req.session.user.id, 'admin_deleted_user', req.params.id);
  res.json({ message: 'Account deleted.' });
}));
app.get('/api/admin/rides', requireRole('admin'), asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*, c.name AS customer_name, d.name AS driver_name
    FROM rides r JOIN users c ON c.id=r.customer_id
    LEFT JOIN users d ON d.id=r.driver_id ORDER BY r.requested_at DESC LIMIT 300`);
  res.json({ rides: rows });
}));
app.get('/api/admin/messages/:rideId', requireRole('admin'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.id,m.message,m.created_at,u.name AS sender_name,u.role
     FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.ride_id=$1 ORDER BY m.created_at`,
    [req.params.rideId]);
  res.json({ messages: rows });
}));

/* ---------------- RIDES ---------------- */
app.post('/api/rides', requireRole('customer'), asyncRoute(async (req, res) => {
  const { pickup, destination, driver_id, vehicle_id, pickup_lat, pickup_lng, destination_lat, destination_lng } = req.body;
  if (!pickup || !destination) return res.status(400).json({ error: 'Pickup and destination are required.' });
  if (driver_id) {
    const d = await pool.query(
      `SELECT u.id FROM users u JOIN vehicles v ON v.driver_id=u.id
       WHERE u.id=$1 AND u.role='driver' AND u.status='approved' AND v.status='approved' AND u.is_online=TRUE AND ($2::uuid IS NULL OR v.id=$2)`, [driver_id, vehicle_id || null]);
    if (!d.rowCount) return res.status(400).json({ error: 'Driver is not available for booking.' });
  }
  const { rows } = await pool.query(
    `INSERT INTO rides(customer_id,driver_id,vehicle_id,pickup,destination,pickup_lat,pickup_lng,destination_lat,destination_lng)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.session.user.id, driver_id || null, vehicle_id || null, pickup, destination, Number.isFinite(Number(pickup_lat)) ? Number(pickup_lat) : null, Number.isFinite(Number(pickup_lng)) ? Number(pickup_lng) : null, Number.isFinite(Number(destination_lat)) ? Number(destination_lat) : null, Number.isFinite(Number(destination_lng)) ? Number(destination_lng) : null]);
  if (rows[0].driver_id) io.to(`user:${rows[0].driver_id}`).emit('ride:request', rows[0]);
  else io.emit('ride:new-request', rows[0]);
  res.status(201).json({ ride: rows[0] });
}));
app.get('/api/rides/mine', requireAuth, asyncRoute(async (req, res) => {
  const col = req.session.user.role === 'driver' ? 'driver_id' : 'customer_id';
  const { rows } = await pool.query(`SELECT * FROM rides WHERE ${col}=$1 ORDER BY requested_at DESC LIMIT 100`, [req.session.user.id]);
  res.json({ rides: rows });
}));
/* ---------------- WALLET & TRANSACTIONS ---------------- */
// Get wallet details & history
app.get('/api/wallet', requireAuth, asyncRoute(async (req,res) => {
  const userId = req.session.user.id;
  const userQ = await pool.query('SELECT wallet_balance FROM users WHERE id=$1', [userId]);
  const txQ = await pool.query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC', [userId]);
  
  // Get admin payment numbers
  const settingsQ = await pool.query('SELECT key, value FROM admin_settings');
  const settings = {};
  settingsQ.rows.forEach(r => settings[r.key] = r.value);

  res.json({ balance: userQ.rows[0].wallet_balance, transactions: txQ.rows, paymentNumbers: settings });
}));

// Request to load money
app.post('/api/wallet/deposit', requireAuth, asyncRoute(async (req,res) => {
  const { amount, method, transaction_id, phone_number } = req.body;
  
  // Explicitly check each field
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Please enter a valid amount.' });
  if (!method) return res.status(400).json({ error: 'Please select a payment method.' });
  if (!transaction_id || transaction_id.trim() === '') return res.status(400).json({ error: 'Transaction ID is required.' });
  if (!phone_number || phone_number.trim() === '') return res.status(400).json({ error: 'Phone number is required.' });

  await pool.query(
    `INSERT INTO transactions (user_id, type, amount, status, method, transaction_id, phone_number) 
     VALUES ($1, 'deposit', $2, 'pending', $3, $4, $5)`,
    [req.session.user.id, amount, method, transaction_id, phone_number]
  );
  res.json({ message: 'Deposit request submitted. Waiting for admin approval.' });
}));

// Admin: Get pending deposits
app.get('/api/admin/transactions/pending', requireRole('admin'), asyncRoute(async (req,res) => {
  const q = await pool.query(`
    SELECT t.*, u.name as user_name, u.mobile as user_mobile 
    FROM transactions t JOIN users u ON u.id = t.user_id 
    WHERE t.type = 'deposit' AND t.status = 'pending' ORDER BY t.created_at DESC
  `);
  res.json({ transactions: q.rows });
}));

// Admin: Approve/Reject deposit
app.post('/api/admin/transactions/:id/process', requireRole('admin'), asyncRoute(async (req,res) => {
  const { action, feedback } = req.body; // action: 'approve' or 'reject'
  const txId = req.params.id;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txQ = await client.query('SELECT * FROM transactions WHERE id=$1 AND status=\'pending\'', [txId]);
    if (!txQ.rowCount) throw new Error('Transaction not found or already processed.');
    const tx = txQ.rows[0];

    if (action === 'approve') {
      await client.query('UPDATE transactions SET status=\'approved\', admin_feedback=$1 WHERE id=$2', [feedback || 'Approved', txId]);
      await client.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id=$2', [tx.amount, tx.user_id]);
    } else {
      await client.query('UPDATE transactions SET status=\'rejected\', admin_feedback=$1 WHERE id=$2', [feedback || 'Rejected by admin', txId]);
    }
    await client.query('COMMIT');
    res.json({ message: `Transaction ${action}d.` });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// Admin: Update payment numbers
app.post('/api/admin/settings/payments', requireRole('admin'), asyncRoute(async (req,res) => {
  const { bkash_number, rocket_number, upay_number } = req.body;
  const updates = [ ['bkash_number', bkash_number], ['rocket_number', rocket_number], ['upay_number', upay_number] ];
  for (let [key, val] of updates) {
    if (val) await pool.query('UPDATE admin_settings SET value=$1 WHERE key=$2', [val, key]);
  }
  res.json({ message: 'Payment numbers updated.' });
}));

/* ---------------- RIDE PAYMENT & RATING ---------------- */
// Pay with Wallet
app.post('/api/rides/:id/pay', requireRole('customer'), asyncRoute(async (req,res) => {
  const rideId = req.params.id;
  const customerId = req.session.user.id;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const rideQ = await client.query('SELECT * FROM rides WHERE id=$1 AND customer_id=$2 AND status=\'completed\' AND payment_status=\'unpaid\'', [rideId, customerId]);
    if (!rideQ.rowCount) throw new Error('Ride not found or already paid.');
    const ride = rideQ.rows[0];
    const fare = Number(ride.final_fare);

    const userQ = await client.query('SELECT wallet_balance FROM users WHERE id=$1', [customerId]);
    if (Number(userQ.rows[0].wallet_balance) < fare) throw new Error('Insufficient wallet balance.');

    // Deduct from customer
    await client.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id=$2', [fare, customerId]);
    // Add to driver
    await client.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id=$2', [fare, ride.driver_id]);
    
    // Update ride
    await client.query('UPDATE rides SET payment_status=\'paid\' WHERE id=$1', [rideId]);

    // Create transactions
    await client.query(`INSERT INTO transactions (user_id, type, amount, status, ride_id) VALUES ($1, 'ride_payment', $2, 'completed', $3)`, [customerId, fare, rideId]);
    await client.query(`INSERT INTO transactions (user_id, type, amount, status, ride_id) VALUES ($1, 'ride_earning', $2, 'completed', $3)`, [ride.driver_id, fare, rideId]);

    await client.query('COMMIT');
    io.to(`user:${ride.driver_id}`).emit('ride:status', ride); // notify driver
    res.json({ message: 'Payment successful.' });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// Rate Driver
app.post('/api/rides/:id/rate', requireRole('customer'), asyncRoute(async (req,res) => {
  const { rating, feedback } = req.body;
  const rideId = req.params.id;
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5.' });

  const rideQ = await pool.query('SELECT driver_id FROM rides WHERE id=$1 AND customer_id=$2 AND status=\'completed\' AND driver_rating IS NULL', [rideId, req.session.user.id]);
  if (!rideQ.rowCount) return res.status(400).json({ error: 'Cannot rate this ride.' });
  const driverId = rideQ.rows[0].driver_id;

  await pool.query('UPDATE rides SET driver_rating=$1, customer_feedback=$2 WHERE id=$3', [rating, feedback, rideId]);
  
  // Recalculate driver average rating
  await pool.query(`
    UPDATE users SET rating = (
      SELECT COALESCE(AVG(driver_rating), 0) FROM rides WHERE driver_id=$1 AND driver_rating IS NOT NULL
    ) WHERE id=$1
  `, [driverId]);

  res.json({ message: 'Rating submitted.' });
}));

// Admin overview of ALL transactions
app.get('/api/admin/transactions', requireRole('admin'), asyncRoute(async (req,res) => {
  const q = await pool.query(`
    SELECT t.*, u.name as user_name, u.mobile as user_mobile, d.name as driver_name 
    FROM transactions t 
    JOIN users u ON u.id = t.user_id 
    LEFT JOIN rides r ON r.id = t.ride_id
    LEFT JOIN users d ON d.id = r.driver_id
    ORDER BY t.created_at DESC LIMIT 500
  `);
  res.json({ transactions: q.rows });
}));
app.post('/api/rides/:id/accept', requireRole('driver'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE rides SET driver_id=$1,status='accepted',accepted_at=NOW()
     WHERE id=$2 AND status='requested' AND (driver_id IS NULL OR driver_id=$1) RETURNING *`,
    [req.session.user.id, req.params.id]);
  if (!rows[0]) return res.status(409).json({ error: 'Ride is no longer available.' });
  io.to(`user:${rows[0].customer_id}`).emit('ride:accepted', rows[0]);
  res.json({ ride: rows[0] });
}));
app.post('/api/rides/:id/offer', requireRole('driver'), asyncRoute(async (req, res) => {
  const fare = Number(req.body.fare);
  if (!Number.isFinite(fare) || fare <= 0) return res.status(400).json({ error: 'Enter a valid fare.' });
  const { rows } = await pool.query(
    `UPDATE rides SET offered_fare=$1,status='offered'
     WHERE id=$2 AND driver_id=$3 AND status IN ('accepted','offered') RETURNING *`,
    [fare, req.params.id, req.session.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Ride not found.' });
  io.to(`user:${rows[0].customer_id}`).emit('ride:offer', rows[0]);
  res.json({ ride: rows[0] });
}));
app.post('/api/rides/:id/confirm', requireRole('customer'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE rides SET final_fare=offered_fare,status='confirmed'
     WHERE id=$1 AND customer_id=$2 AND status='offered' RETURNING *`,
    [req.params.id, req.session.user.id]);
  if (!rows[0]) return res.status(409).json({ error: 'No active fare offer found.' });
  io.to(`user:${rows[0].driver_id}`).emit('ride:confirmed', rows[0]);
  res.json({ ride: rows[0] });
}));
app.post('/api/rides/:id/start', requireRole('driver'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE rides SET status='started' WHERE id=$1 AND driver_id=$2 AND status='confirmed' RETURNING *`,
    [req.params.id, req.session.user.id]);
  if (!rows[0]) return res.status(409).json({ error: 'Ride cannot be started.' });
  io.to(`user:${rows[0].customer_id}`).emit('ride:status', rows[0]);
  res.json({ ride: rows[0] });
}));
app.post('/api/rides/:id/complete', requireRole('driver'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE rides SET status='completed',completed_at=NOW() WHERE id=$1 AND driver_id=$2 AND status='started' RETURNING *`,
    [req.params.id, req.session.user.id]);
  if (!rows[0]) return res.status(409).json({ error: 'Ride cannot be completed.' });
  io.to(`user:${rows[0].customer_id}`).emit('ride:status', rows[0]);
  res.json({ ride: rows[0] });
}));
app.post('/api/rides/:id/cancel', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE rides SET status='cancelled' WHERE id=$1 AND status IN ('requested','accepted','offered','confirmed')
     AND (customer_id=$2 OR driver_id=$2) RETURNING *`,
    [req.params.id, req.session.user.id]);
  if (!rows[0]) return res.status(409).json({ error: 'Ride cannot be cancelled.' });
  const other = rows[0].customer_id === req.session.user.id ? rows[0].driver_id : rows[0].customer_id;
  if (other) io.to(`user:${other}`).emit('ride:status', rows[0]);
  res.json({ ride: rows[0] });
}));

async function canAccessRide(rideId, user) {
  const { rows } = await pool.query('SELECT customer_id,driver_id,status FROM rides WHERE id=$1', [rideId]);
  return rows[0] && (user.role === 'admin' || rows[0].customer_id === user.id || rows[0].driver_id === user.id) ? rows[0] : null;
}
app.get('/api/rides/:id/messages', requireAuth, asyncRoute(async (req, res) => {
  const ride = await canAccessRide(req.params.id, req.session.user);
  if (!ride) return res.status(403).json({ error: 'No access to this ride.' });
  const { rows } = await pool.query(
    `SELECT m.id,m.message,m.created_at,u.name AS sender_name,u.id AS sender_id,u.profile_photo,u.role
     FROM messages m JOIN users u ON u.id=m.sender_id WHERE ride_id=$1 ORDER BY created_at`, [req.params.id]);
  res.json({ messages: rows });
}));
app.post('/api/rides/:id/messages', requireAuth, asyncRoute(async (req, res) => {
  const user = req.session.user, message = String(req.body.message || '').trim();
  const ride = await canAccessRide(req.params.id, user);
  if (!ride || user.role === 'admin' || !['accepted', 'offered', 'confirmed', 'started'].includes(ride.status))
    return res.status(403).json({ error: 'Chat is available only to the ride participants after driver acceptance.' });
  if (!message || message.length > 2000) return res.status(400).json({ error: 'Message must be 1–2000 characters.' });
  const { rows } = await pool.query(
    `INSERT INTO messages(ride_id,sender_id,message) VALUES($1,$2,$3) RETURNING *`,
    [req.params.id, user.id, message]);
  const payload = { ...rows[0], sender_name: user.name, sender_id: user.id, profile_photo: (await pool.query('SELECT profile_photo FROM users WHERE id=$1', [user.id])).rows[0]?.profile_photo || null };
  io.to(`ride:${req.params.id}`).emit('chat:message', payload);
  res.status(201).json({ message: payload });
}));

/* ---------------- DRIVER ---------------- */
app.get('/api/driver/requests', requireRole('driver'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*,u.name AS customer_name,u.profile_photo AS customer_photo FROM rides r JOIN users u ON u.id=r.customer_id
     WHERE r.status='requested' AND (r.driver_id IS NULL OR r.driver_id=$1)
     ORDER BY r.requested_at DESC LIMIT 50`, [req.session.user.id]);
  res.json({ rides: rows });
}));

/* ---------------- FEATURE (iv): DRIVER CURRENT LOCATION ---------------- */
app.post('/api/driver/location', requireRole('driver'), asyncRoute(async (req, res) => {
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'Valid coordinates required.' });
  await pool.query('UPDATE users SET current_lat=$1,current_lng=$2,updated_at=NOW() WHERE id=$3', [lat, lng, req.session.user.id]);
  res.json({ lat, lng });
}));

app.post('/api/driver/availability', requireRole('driver'), asyncRoute(async (req, res) => {
  const lat = Number(req.body.lat), lng = Number(req.body.lng), online = Boolean(req.body.online); if (online && (!Number.isFinite(lat) || !Number.isFinite(lng))) return res.status(400).json({ error: 'Location permission is required to appear as an available nearby driver.' });
  await pool.query('UPDATE users SET is_online=$1,current_lat=$2,current_lng=$3,updated_at=NOW() WHERE id=$4', [online, online ? lat : null, online ? lng : null, req.session.user.id]); res.json({ online });
}));

/* ---------------- FEATURE (iv + v): NEARBY DRIVERS WITH RANGE ---------------- */
app.get('/api/drivers/nearby',requireRole('customer'),asyncRoute(async(req,res)=>{
 const lat=Number(req.query.lat),lng=Number(req.query.lng),radius=Math.min(Math.max(Number(req.query.radius)||15,0.5),100);
 if(!Number.isFinite(lat)||!Number.isFinite(lng))return res.status(400).json({error:'Pickup coordinates are required.'});
 
 // Fixed SQL query: Added explicit $1 and $2 references and properly mapped $3 for radius
 const {rows}=await pool.query(`
   SELECT u.id, u.name, u.mobile, u.profile_photo, u.rating, u.is_online,
          v.id AS vehicle_id, v.make_model, v.vehicle_type, v.vehicle_size, v.registration_number, v.color, v.details AS vehicle_details, v.photo_file,
          (6371 * 2 * ASIN(SQRT(
              POWER(SIN(RADIANS(u.current_lat - $1) / 2), 2) + 
              COS(RADIANS($1)) * COS(RADIANS(u.current_lat)) * 
              POWER(SIN(RADIANS(u.current_lng - $2) / 2), 2)
          ))) AS distance_km
   FROM users u 
   JOIN vehicles v ON v.driver_id = u.id
   WHERE u.role = 'driver' 
     AND u.status = 'approved' 
     AND v.status = 'approved' 
     AND u.is_online = TRUE
     AND u.current_lat IS NOT NULL 
     AND u.current_lng IS NOT NULL
     AND (6371 * 2 * ASIN(SQRT(
              POWER(SIN(RADIANS(u.current_lat - $1) / 2), 2) + 
              COS(RADIANS($1)) * COS(RADIANS(u.current_lat)) * 
              POWER(SIN(RADIANS(u.current_lng - $2) / 2), 2)
          ))) <= $3
   ORDER BY distance_km`, [lat, lng, radius]);
   
 res.json({drivers:rows, radius});
}));

/* ---------------- FEATURE (ii): GEOCODING AUTOCOMPLETE ---------------- */
// Proxy to Nominatim (avoids browser CORS + respects UA). Simple in-memory cache.
const geoCache = new Map();
app.get('/api/geocode', requireAuth, asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ results: [] });
  const key = 'g:' + q.toLowerCase();
  if (geoCache.has(key)) return res.json({ results: geoCache.get(key) });
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'RideFlow/1.0 (contact@rideflow.local)', 'Accept': 'application/json' } });
  if (!r.ok) return res.status(502).json({ error: 'Geocoding service unavailable.' });
  const raw = await r.json();
  const results = raw.map(x => ({ lat: Number(x.lat), lon: Number(x.lon), display_name: x.display_name, type: x.type || x.class || '' }));
  geoCache.set(key, results);
  res.json({ results });
}));
app.get('/api/reverse-geocode', requireAuth, asyncRoute(async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat/lng required.' });
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'RideFlow/1.0 (contact@rideflow.local)', 'Accept': 'application/json' } });
  if (!r.ok) return res.status(502).json({ error: 'Geocoding service unavailable.' });
  const data = await r.json();
  res.json({ display_name: data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}` });
}));

/* ---------------- PROFILE ---------------- */
app.get('/api/profile', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`SELECT u.id,u.role,u.name,u.mobile,u.email,u.present_address,u.permanent_address,u.profile_photo,u.rating,u.is_online,u.current_lat,u.current_lng,v.registration_number,v.make_model,v.vehicle_type,v.vehicle_size,v.color,v.details AS vehicle_details,v.photo_file FROM users u LEFT JOIN vehicles v ON v.driver_id=u.id WHERE u.id=$1`, [req.session.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Profile not found.' }); res.json({ profile: rows[0] });
}));
app.patch('/api/profile', requireAuth, asyncRoute(async (req, res) => {
  const u = req.session.user, b = req.body;
  const { rows } = await pool.query(`UPDATE users SET name=COALESCE($1,name),mobile=COALESCE($2,mobile),email=$3,present_address=$4,permanent_address=$5,updated_at=NOW() WHERE id=$6 RETURNING id,role,name,mobile,email,present_address,permanent_address,profile_photo`, [b.name?.trim() || null, b.mobile?.trim() || null, b.email || null, b.present_address || null, b.permanent_address || null, u.id]);
  if (u.role === 'driver') await pool.query(`UPDATE vehicles SET make_model=COALESCE($1,make_model),vehicle_type=COALESCE($2,vehicle_type),vehicle_size=$3,color=$4,details=$5 WHERE driver_id=$6`, [b.make_model?.trim() || null, b.vehicle_type?.trim() || null, b.vehicle_size || null, b.color || null, b.vehicle_details || null, u.id]);
  req.session.user.name = rows[0].name; req.session.user.mobile = rows[0].mobile; res.json({ profile: rows[0] });
}));


app.post('/api/profile/photos', requireAuth, upload.fields([{ name: 'profilePhoto', maxCount: 1 }, { name: 'vehiclePhoto', maxCount: 1 }]), asyncRoute(async (req, res) => {
  const u = req.session.user, profile = req.files?.profilePhoto?.[0], vehicle = req.files?.vehiclePhoto?.[0]; if (!profile && !vehicle) return res.status(400).json({ error: 'Choose at least one image.' });
  if (profile) { const old = await pool.query('SELECT profile_photo FROM users WHERE id=$1', [u.id]); await pool.query('UPDATE users SET profile_photo=$1,updated_at=NOW() WHERE id=$2', [profile.filename, u.id]); if (old.rows[0]?.profile_photo) { const x = path.join(uploadDir, path.basename(old.rows[0].profile_photo)); if (fs.existsSync(x)) fs.unlinkSync(x) } }
  if (vehicle && u.role === 'driver') { const old = await pool.query('SELECT photo_file FROM vehicles WHERE driver_id=$1', [u.id]); await pool.query('UPDATE vehicles SET photo_file=$1 WHERE driver_id=$2', [vehicle.filename, u.id]); if (old.rows[0]?.photo_file) { const x = path.join(uploadDir, path.basename(old.rows[0].photo_file)); if (fs.existsSync(x)) fs.unlinkSync(x) } }
  res.json({ message: 'Photos updated.' });
}));
app.delete('/api/profile/photos/:kind', requireAuth, asyncRoute(async (req, res) => {
  const u = req.session.user, kind = req.params.kind; if (!['profile', 'vehicle'].includes(kind) || (kind === 'vehicle' && u.role !== 'driver')) return res.status(400).json({ error: 'Invalid photo type.' });
  if (kind === 'profile') await pool.query('UPDATE users SET profile_photo=NULL WHERE id=$1', [u.id]); else await pool.query('UPDATE vehicles SET photo_file=NULL WHERE driver_id=$1', [u.id]); res.json({ message: 'Photo removed.' });
}));
app.get('/api/media/:kind/:id', requireAuth, asyncRoute(async (req, res) => {
  let filename; if (req.params.kind === 'profile') { const q = await pool.query('SELECT profile_photo FROM users WHERE id=$1', [req.params.id]); filename = q.rows[0]?.profile_photo } else if (req.params.kind === 'vehicle') { const q = await pool.query('SELECT photo_file FROM vehicles WHERE driver_id=$1', [req.params.id]); filename = q.rows[0]?.photo_file } else return res.status(400).end();
  if (!filename) return res.status(404).end(); const full = path.join(uploadDir, path.basename(filename)); if (!fs.existsSync(full)) return res.status(404).end(); res.setHeader('Cache-Control', 'private, no-store'); res.sendFile(full);
}));

/* ---------------- SOCKET ---------------- */
io.use((socket, next) => { next(); });
io.on('connection', socket => {
  const user = socket.request?.session?.user;
  if (!user) return;
  socket.join(`user:${user.id}`);
  socket.on('ride:join', async rideId => {
    const ride = await canAccessRide(rideId, user);
    if (ride) socket.join(`ride:${rideId}`);
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.code === '23505' ? 'That mobile number or email is already registered.' : err.message || 'Server error.' });
});
server.listen(PORT, () => console.log(`RideFlow running at http://localhost:${PORT}`));