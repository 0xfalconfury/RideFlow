# RideFlow — Ride Booking Platform

RideFlow is a Node.js, Express, PostgreSQL and Socket.IO starter for a three-portal ride-booking application.

## Included
- Customer, driver and admin roles
- Admin-created accounts through an interactive CLI
- Customer and driver registration with approval status
- Private storage for NID and vehicle images (not served as public static files)
- Driver vehicle registration
- Ride requests, driver acceptance, fare offers and customer confirmation
- Ride start, completion and cancellation
- Ride-participant chat after driver acceptance
- Admin overview, account management, ride history and chat-log review
- Responsive mobile-first landing page and dashboard UI

## Requirements
- Node.js 20+
- PostgreSQL 14+
- npm

## Setup (Windows PowerShell)

1. Extract this folder.
2. Open PowerShell inside the project folder.
3. Install packages:

   ```powershell
   npm install
   ```

4. Create a PostgreSQL database:

   ```sql
   CREATE DATABASE rideflow;
   ```

5. Copy `.env.example` to `.env` and set your PostgreSQL password and a long random `SESSION_SECRET`.

6. Run the schema. If `psql` is not in PATH, use the full executable path:

   ```powershell
   & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d rideflow -f schema.sql
   ```

   Change `16` to your installed PostgreSQL version and adjust the path if PostgreSQL is installed elsewhere.

7. Create your first admin:

   ```powershell
   npm run create-admin
   ```

8. Start the server:

   ```powershell
   npm run dev
   ```

9. Open `http://localhost:3000`.

## Important implementation notes

- Registration is pending until an admin approves the account.
- Admin creation is deliberately handled by the local CLI, not by public registration.
- Uploaded identity images are stored under `private_uploads/`, outside the public web directory. Do not expose this directory with `express.static`.
- This is a functional MVP foundation, not a production-ready Uber replacement. Before real deployment, add verified document-review screens, secure authorized document delivery, rate limiting, CSRF protection, password reset, stronger audit trails, account deletion policies, backups, monitoring, and a security review.
- Ride fares shown as gross ride value are not platform earnings. Add a commission/payment ledger before reporting actual company revenue.
- Live GPS tracking, map autocomplete, payment gateway integration, driver availability toggles, push notifications, and advanced search are planned extensions.
- Admin chat-log access should be governed by a clear privacy policy and restricted audit trail.
- Never use real identity documents during local development. Use synthetic test data and protect real NID data with encryption, strict access controls, retention limits and legal review.

## Main files

| File | Purpose |
|---|---|
| `server.js` | Express API, sessions, ride workflow, Socket.IO |
| `schema.sql` | PostgreSQL tables and indexes |
| `create-admin.js` | Interactive admin manager |
| `public/index.html` | Landing page, authentication and dashboard shell |
| `public/style.css` | Responsive visual design |
| `public/app.js` | Frontend interactions and API calls |
| `.env.example` | Environment variable template |

## Current MVP limitations
- Driver requests can be targeted to one driver or broadcast to available drivers. Broadcast requests currently use Socket.IO to notify connected clients, while the driver request list polls the database when opened.
- No real map or GPS tracking is connected yet.
- Vehicle approval is represented in the database; add a dedicated admin vehicle-review screen before launch.
- A user can register with a file upload; access to the private document files must be implemented through an authenticated admin-only route before production.


## Map, Nearby Drivers & Profile Upgrade

The upgraded build includes an OpenStreetMap/Leaflet route picker, address lookup using Nominatim, pickup-area driver discovery (15 km default), driver online/offline location sharing, expandable driver cards, profile pictures, vehicle photos, and profile editing. Drivers must explicitly choose **Go online** and grant browser location permission before appearing in nearby searches. Location is cleared when they go offline.

### Apply the database upgrade

Run the updated `schema.sql` against your existing `rideflow` database. The upgrade uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so existing account and ride records are retained. Back up your database first.

### Map services

The map uses Leaflet with OpenStreetMap tiles and Nominatim address search. Follow the providers' usage policies and attribution requirements. For a public production service, configure a suitable geocoding provider with usage limits and an API key/proxy where required.

### Notes

- Nearby drivers are currently searched within 15 km of the pickup coordinates.
- A driver is shown only when their account and vehicle are approved and they are online with a recent location. Add location-expiry/heartbeat handling before production deployment.
- Ratings are shown as **New driver** until a real post-ride rating workflow is implemented; no rating is fabricated.
- Profile and vehicle image routes require authentication. Keep NID documents private and never expose the private upload directory as static content.
