CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','customer','driver')),
  name VARCHAR(120) NOT NULL,
  mobile VARCHAR(30) NOT NULL UNIQUE,
  email VARCHAR(180) UNIQUE,
  password_hash TEXT NOT NULL,
  present_address TEXT,
  permanent_address TEXT,
  nid_number VARCHAR(80),
  nid_file TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registration_number VARCHAR(50) NOT NULL UNIQUE,
  make_model VARCHAR(120) NOT NULL,
  vehicle_type VARCHAR(40) NOT NULL,
  color VARCHAR(40),
  details TEXT,
  photo_file TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected'))
);

CREATE TABLE IF NOT EXISTS rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),
  driver_id UUID REFERENCES users(id),
  vehicle_id UUID REFERENCES vehicles(id),
  pickup TEXT NOT NULL,
  destination TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','accepted','offered','confirmed','started','completed','cancelled','declined')),
  offered_fare NUMERIC(12,2),
  final_fare NUMERIC(12,2),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES users(id),
  action VARCHAR(120) NOT NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role,status);
CREATE INDEX IF NOT EXISTS idx_rides_customer ON rides(customer_id,requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id,requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_ride ON messages(ride_id,created_at);


-- RideFlow location, availability and profile-photo upgrade (safe for existing databases)
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2) NOT NULL DEFAULT 0.00;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_size VARCHAR(40);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS photo_gallery JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_lng DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS destination_lat DOUBLE PRECISION;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS destination_lng DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS idx_driver_location ON users(role,status,is_online);

ALTER TABLE users ALTER COLUMN rating SET DEFAULT 0.00;
UPDATE users SET rating=0.00 WHERE rating=5.00;

-- Add wallet balance to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00;

-- Add payment status to rides
ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'unpaid'; -- unpaid, paid

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'ride_payment', 'ride_earning')),
  amount NUMERIC(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  method VARCHAR(20), -- bkash, rocket, upay (for deposits)
  transaction_id VARCHAR(100),
  phone_number VARCHAR(30),
  admin_feedback TEXT,
  ride_id UUID REFERENCES rides(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add rating columns to rides
ALTER TABLE rides ADD COLUMN IF NOT EXISTS driver_rating INTEGER;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS customer_feedback TEXT;

-- Admin settings table for payment numbers
CREATE TABLE IF NOT EXISTS admin_settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT
);
INSERT INTO admin_settings (key, value) VALUES 
('bkash_number', '01700000000'),
('rocket_number', '01700000001'),
('upay_number', '01700000002')
ON CONFLICT (key) DO NOTHING;