require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    while (true) {
      console.log('\n========== RIDEFLOW ADMIN MANAGER ==========');
      console.log('1. Add admin');
      console.log('2. Show admins');
      console.log('3. Change admin password');
      console.log('4. Delete admin');
      console.log('5. Exit');
      const choice = (await ask('Choose an option: ')).trim();

      if (choice === '1') {
        const name = (await ask('Admin name: ')).trim();
        const mobile = (await ask('Admin mobile: ')).trim();
        const email = (await ask('Admin email (optional): ')).trim() || null;
        const password = await ask('Password (minimum 10 characters): ');
        if (!name || !mobile || password.length < 10) {
          console.log('Name, mobile and a 10-character password are required.');
          continue;
        }
        const hash = await bcrypt.hash(password, 12);
        await pool.query(
          `INSERT INTO users(role,name,mobile,email,password_hash,status)
           VALUES('admin',$1,$2,$3,$4,'approved')`,
          [name,mobile,email,hash]
        );
        console.log('Admin created.');
      } else if (choice === '2') {
        const { rows } = await pool.query(
          `SELECT id,name,mobile,email,created_at FROM users WHERE role='admin' ORDER BY created_at`
        );
        console.table(rows);
      } else if (choice === '3') {
        const id = (await ask('Admin ID: ')).trim();
        const password = await ask('New password (minimum 10 characters): ');
        if (password.length < 10) { console.log('Password too short.'); continue; }
        const hash = await bcrypt.hash(password,12);
        const result = await pool.query(
          `UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2 AND role='admin'`,
          [hash,id]
        );
        console.log(result.rowCount ? 'Password changed.' : 'Admin not found.');
      } else if (choice === '4') {
        const id = (await ask('Admin ID to delete: ')).trim();
        const confirm = (await ask('Type DELETE to confirm: ')).trim();
        if (confirm !== 'DELETE') { console.log('Cancelled.'); continue; }
        const count = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE role='admin'`);
        if (count.rows[0].n <= 1) { console.log('Cannot delete the last admin.'); continue; }
        const result = await pool.query(`DELETE FROM users WHERE id=$1 AND role='admin'`,[id]);
        console.log(result.rowCount ? 'Admin deleted.' : 'Admin not found.');
      } else if (choice === '5') break;
      else console.log('Invalid option.');
    }
  } catch (err) {
    console.error('Admin manager error:', err.message);
  } finally {
    await pool.end();
    rl.close();
  }
}
main();
