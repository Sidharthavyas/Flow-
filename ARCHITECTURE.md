# Flow architecture

## Authentication

Flow uses first-party email/password authentication for now:

- Passwords: bcrypt, cost 12.
- Sessions: 256-bit random tokens. Only a SHA-256 hash is stored in MongoDB.
- Browser cookie: `flow_session`, HttpOnly, SameSite=Lax, Secure in production.
- Session TTL: 30 days, enforced by MongoDB TTL index.
- Protected dashboard: server-side `requireUser()` redirect.
- Protected APIs: all queries are scoped to the authenticated `userId`.

No Google/OAuth provider is included.

## Data model

- `User` — account, preferred money view, and private custom expense categories
- `Session`
- `Expense`
- `Saving` — opening balances, deposits, withdrawals, and account-to-account transfers
- `Investment`
- `Budget`

Money is stored in integer paise and converted to rupees at the API boundary.
Dates used for personal finance grouping are stored as `YYYY-MM-DD` date keys to avoid timezone shifts.

Savings are derived from activity rather than a manually maintained total:

- Opening balance / deposit: adds to the destination account.
- Withdrawal: subtracts from the source account.
- Transfer: subtracts from one account and adds to another, so total savings stay unchanged.

## API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET/PATCH /api/preferences`
- `GET/POST /api/expenses`
- `PATCH/DELETE /api/expenses/:id`
- `GET/POST /api/savings`
- `PATCH/DELETE /api/savings/:id`
- `GET/POST /api/investments`
- `PATCH/DELETE /api/investments/:id`
- `GET/PUT /api/budgets`
- `GET /api/export`

## Responsive strategy

- 320–699px: mobile source layout, bottom navigation, bottom sheets.
- 700–1023px: tablet layout, multi-column summaries and sections.
- 1024px+: desktop side rail, centered wide content, modal-style sheets.
- Motion respects `prefers-reduced-motion`.
