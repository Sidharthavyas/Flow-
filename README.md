# Flow — Production Next.js money tracker

A responsive, mobile-first expense, savings, and investment tracker built with Next.js App Router, React, MongoDB + Mongoose, Zod validation, and database-backed email/password sessions.

## What Flow tracks

- Expenses with adaptive budget pacing, search, filters, and 5-item pagination.
- Savings with opening balances, deposits, withdrawals, and neutral account transfers.
- Investments with allocation and current-vs-invested tracking.
- User-specific expense categories that are private to each account.
- A saved Savings / Investments preference that changes the second navigation tab.

For users without investments, the money view defaults to Savings. Existing users who already have investments keep Investments as the fallback until they explicitly choose a preference.

## Stack

- Next.js 16.3.1 / React 19.2
- MongoDB + Mongoose
- Credentials auth (email/password), bcrypt hashing, HttpOnly session cookie
- Zod server-side request validation
- Vanilla CSS + React animations (no heavy UI/chart library)

## Local setup

1. Install Node.js 20.19+ and MongoDB (or create a MongoDB Atlas database).
2. Copy `.env.example` to `.env.local` and set `MONGODB_URI`.
3. Run:

```bash
npm install
npm run dev
```

Open http://localhost:3000 and create an account.

## Production

- Deploy to Vercel/Node hosting and set `MONGODB_URI` as a production secret.
- Use MongoDB Atlas with TLS/IP access configured for your deployment.
- The session cookie is HttpOnly, SameSite=Lax, and Secure in production.
- Sessions are stored hashed in MongoDB and automatically expire via a TTL index.
- Money is stored as integer paise to avoid floating-point accounting errors.
- Every CRUD query is scoped by authenticated `userId`.

For a public/high-traffic launch, add an external rate limiter (for example at your CDN/platform level) to `/api/auth/login` and `/api/auth/register`.
