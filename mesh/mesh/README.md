# Mesh

> **Find your founding team. Build something real.**

Mesh is an open-source team-matching platform for builders, designers, and operators. Post your profile, filter by track, timezone, and role, and connect with the right people — for hackathons, startups, or any project.

![Status](https://img.shields.io/badge/status-live-brightgreen?style=flat-square) ![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square) ![Stack](https://img.shields.io/badge/stack-Turso%20%2B%20Vercel-4f46e5?style=flat-square)

---

## Tech Stack

| Layer    | Tool |
|----------|------|
| Frontend | Vanilla HTML / CSS / JS (ES Modules) |
| API      | Vercel Serverless Functions |
| Database | Turso (SQLite at the edge) |
| Auth     | JWT (jose) + bcrypt |
| Hosting  | Vercel |

---

## Features

- Browse and filter builders by track, role, and timezone
- Email + password sign up / sign in
- Post your profile with skills and who you're looking for
- Send invites — persisted to your account
- Delete your own profile
- Live search across names, roles, and skills

---

## Project Structure

```
Mesh/
├── api/
│   ├── _lib.js        # Shared DB client, JWT, bcrypt helpers
│   ├── auth.js        # POST /api/auth?action=signup|signin
│   ├── profiles.js    # GET / POST / DELETE /api/profiles
│   ├── invites.js     # GET / POST /api/invites
│   └── init.js        # One-time DB table creation
├── js/
│   └── api.js         # Frontend fetch wrapper
├── public/
│   └── index.html     # Main app UI
├── package.json
├── vercel.json
└── README.md
```

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/Asadullah0575/mesh.git
cd mesh
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create a Turso database

```bash
# Install Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# Log in
turso auth login

# Create DB
turso db create mesh

# Get your URL and token
turso db show mesh --url
turso db tokens create mesh
```

Or create a database from the [Turso dashboard](https://app.turso.tech).

### 4. Set environment variables

Create a `.env` file (never commit this):

```env
TURSO_DATABASE_URL=libsql://mesh-yourname.turso.io
TURSO_AUTH_TOKEN=your-turso-token
JWT_SECRET=a-long-random-secret-string-at-least-32-chars
```

Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Create the database tables

Start the dev server first:
```bash
npm run dev
```

Then visit:
```
http://localhost:3000/api/init?secret=FIRST8CHARSOFYOURJWTSECRET
```

You should see `{"ok":true,"message":"Tables created successfully"}`.

### 6. Run locally

```bash
npm run dev
# → http://localhost:3000
```

---

## Deploy to Vercel

### Step 1 — Push to GitHub

```bash
git add .
git commit -m "feat: add Turso backend"
git push
```

### Step 2 — Import on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import `Asadullah0575/mesh`
3. Framework preset: **Other**

### Step 3 — Add environment variables

In Vercel project settings → **Environment Variables**, add:

| Key | Value |
|-----|-------|
| `TURSO_DATABASE_URL` | `libsql://mesh-yourname.turso.io` |
| `TURSO_AUTH_TOKEN` | your Turso token |
| `JWT_SECRET` | your random secret string |

### Step 4 — Deploy

Click **Deploy**. Your app will be live at `https://mesh.vercel.app`.

### Step 5 — Init the database

After deploy, visit once:
```
https://mesh.vercel.app/api/init?secret=FIRST8CHARSOFYOURJWTSECRET
```

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth?action=signup` | — | Create account |
| POST | `/api/auth?action=signin` | — | Sign in, returns JWT |
| GET | `/api/profiles` | — | List all profiles |
| POST | `/api/profiles` | ✓ | Create your profile |
| DELETE | `/api/profiles?id=` | ✓ | Delete your profile |
| GET | `/api/invites` | ✓ | Get your sent invites |
| POST | `/api/invites` | ✓ | Send an invite |

---

## Roadmap

- [ ] Real-time presence via Turso sync
- [ ] In-app messaging
- [ ] Team formation flow
- [ ] Profile editing
- [ ] OAuth (GitHub / Google)
- [ ] Email notifications on invite

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.

---

<p align="center">Built by <a href="https://github.com/Asadullah0575">Asadullah0575</a></p>
