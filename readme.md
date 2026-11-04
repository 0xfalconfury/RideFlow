# 🚗 RideFlow — Smart Ride Booking Platform

**RideFlow** is a web-based ride-booking platform designed to connect customers with drivers through a simple, interactive, and integrated system.

The platform provides three dedicated portals — **Admin, Customer, and Driver** — allowing users to manage registrations, book rides, negotiate fares, communicate through live chat, and monitor ride activities.

Built with HTML, CSS, JavaScript, Node.js, Express.js, and PostgreSQL.

---

## ✨ Key Features

### 👨‍💼 Admin Portal

- Dashboard with platform statistics.
- View total customers, drivers, bookings, and ride information.
- Review customer and driver registrations.
- Approve or reject registration requests.
- View detailed customer profiles.
- View detailed driver profiles and vehicle information.
- Edit customer and driver information.
- Manage user and driver accounts.
- View ride history and booking information.
- Monitor platform activities and chat records.
- Manage administrator accounts through a command-line utility.

### 👤 Customer Portal

- Customer registration with personal information.
- Submit NID information and document images.
- Admin approval before account activation.
- Search and request available rides.
- Enter pickup and destination locations.
- View driver and vehicle information.
- Receive driver fare offers.
- Accept or reject proposed fares.
- Communicate with drivers through ride-based chat.
- Track ride status.
- View previous ride history.
- Manage account information.

### 🚘 Driver Portal

- Driver registration with personal information.
- Submit NID information and document images.
- Submit vehicle registration details.
- Upload vehicle photographs.
- Admin approval before account activation.
- Receive customer ride requests.
- Accept or reject ride requests.
- Propose fares to customers.
- Communicate with customers through chat.
- Manage ride status.
- View completed and cancelled rides.
- Monitor ride statistics and earnings.
- Update personal and vehicle information.

### 💬 Communication System

- Ride-specific customer-driver conversations.
- Real-time messaging using Socket.IO.
- Messages associated with individual rides.
- Admin access to available chat records.

---

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| HTML5 | Application structure |
| CSS3 | Responsive interface and styling |
| JavaScript (ES6+) | Frontend interactions |
| Node.js | Backend runtime |
| Express.js | Server and REST APIs |
| PostgreSQL | Relational database |
| Socket.IO | Real-time communication |
| pg | PostgreSQL database connection |
| bcryptjs | Password hashing |
| Express Session | User session management |
| Multer | Document and image uploads |
| Helmet | HTTP security headers |
| dotenv | Environment configuration |

---

## 📁 Project Structure

```text
RideFlow/
│
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── private_uploads/
│   └── .gitkeep
│
├── server.js
├── create-admin.js
├── schema.sql
├── package.json
├── package-lock.json
├── .env
├── .env.example
├── .gitignore
└── README.md
```

---

## ⚙️ Installation and Setup

### 1. Prerequisites

Make sure the following software is installed:

- [Node.js](https://nodejs.org/)
- [PostgreSQL](https://www.postgresql.org/)
- [Git](https://git-scm.com/)
- [Visual Studio Code](https://code.visualstudio.com/)

### 2. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/RideFlow.git
```

Navigate to the project directory:

```bash
cd RideFlow
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Create the PostgreSQL Database

Open PostgreSQL or pgAdmin and execute:

```sql
CREATE DATABASE rideflow;
```

### 5. Configure Environment Variables

Create a `.env` file in the root directory.

```env
PORT=3000

DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/rideflow

SESSION_SECRET=replace_with_a_long_random_secret

NODE_ENV=development
```

Replace `YOUR_PASSWORD` with your PostgreSQL password.

If your password contains special characters, URL-encode them in the connection string.

### 6. Execute the Database Schema

Run the following command from the project root:

```bash
psql -U postgres -d rideflow -f schema.sql
```

This executes the SQL schema and creates the required database tables.

If `psql` is not recognized, add PostgreSQL's `bin` directory to your Windows PATH.

### 7. Create an Administrator Account

Run:

```bash
node create-admin.js
```

Follow the interactive instructions to create your first administrator.

The utility also provides administrator management options.

### 8. Start the Application

Development mode:

```bash
npm run dev
```

Alternatively, if your package scripts do not include a development command:

```bash
node server.js
```

Open your browser:

```text
http://localhost:3000
```

---

## 🔄 Application Workflow

### Customer Workflow

1. Customer creates an account.
2. Registration is submitted for admin approval.
3. Admin reviews the customer's information.
4. Approved customer logs in.
5. Customer submits a ride request.
6. Driver receives the ride request.
7. Driver accepts and proposes a fare.
8. Customer accepts or rejects the proposed fare.
9. Customer and driver communicate through ride-based chat.
10. Driver manages the ride until completion.

### Driver Workflow

1. Driver submits registration information.
2. Driver uploads NID and vehicle documents.
3. Admin reviews the registration.
4. Approved driver logs in.
5. Driver receives ride requests.
6. Driver accepts or rejects requests.
7. Driver proposes a fare.
8. Customer confirms the fare.
9. Driver communicates with the customer.
10. Driver updates the ride status.

### Admin Workflow

1. Administrator logs in.
2. Admin reviews platform statistics.
3. Admin manages customer registrations.
4. Admin manages driver registrations.
5. Admin views and edits account information.
6. Admin monitors bookings and ride activities.
7. Admin reviews available communication records.

---

## 🔐 Security Considerations

RideFlow includes several security-related components:

- Password hashing using bcryptjs.
- Session-based authentication.
- PostgreSQL-backed session storage.
- Helmet security headers.
- Server-side validation.
- Role-based access controls.
- Restricted access to uploaded documents.
- Registration approval workflow.

**Production recommendations:**

- Use HTTPS.
- Configure secure session cookies.
- Add CSRF protection and API rate limiting.
- Encrypt sensitive personal information.
- Implement secure document access and retention policies.
- Use strong session secrets.
- Configure automated database backups.
- Review authorization rules for every protected endpoint.
- Avoid committing `.env` files or private documents.

Never upload real NID images or other sensitive personal information to a public GitHub repository.

---

## 🗄️ Database Overview

The PostgreSQL database contains the core entities used by the application.

| Table | Description |
|---|---|
| `users` | Customer, driver, and administrator accounts |
| `vehicles` | Driver vehicle information |
| `rides` | Ride requests, fare offers, and ride status |
| `messages` | Ride-based communication |
| `audit_logs` | Administrative activity records |

Refer to `schema.sql` for the database structure and relationships.

---

## 🚧 Future Improvements

The following features can extend RideFlow into a more complete ride-hailing platform:

- [ ] Live GPS tracking.
- [ ] Interactive maps and route visualization.
- [ ] Driver availability and online/offline status.
- [ ] Advanced driver and vehicle search.
- [ ] Automated driver matching.
- [ ] Distance-based fare estimation.
- [ ] Online payment integration.
- [ ] Platform commission management.
- [ ] Customer and driver ratings.
- [ ] Ride cancellation policies.
- [ ] Push notifications.
- [ ] Email and SMS notifications.
- [ ] Advanced analytics and reporting.
- [ ] Database backup and recovery.
- [ ] Advanced audit logging.

---

## ⚠️ Project Status

**RideFlow is an ongoing development project.**

The current implementation provides the foundation for an integrated ride-booking system. Some advanced features, including live GPS tracking, payment processing, and production-grade operational controls, require further development.

The project should be tested thoroughly before being used with real customers or drivers.

---

## 🤝 Contributing

Contributions, suggestions, and improvements are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Push the branch.
5. Open a Pull Request.

---

## 📄 License

This project is intended for educational and development purposes.

Add a `LICENSE` file if you intend to distribute the project under a specific open-source license.

---

## 👨‍💻 Author

**RideFlow — Smart Ride Booking Platform**

Developed using Node.js, Express.js, PostgreSQL, and modern web technologies.

**Good rides. Better journeys.** 🚗****
