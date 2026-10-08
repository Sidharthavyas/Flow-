# Flow update — Auto-add expenses from bank SMS (needs app v1.3.0)

- Android app 1.3.0 forwards new bank transaction SMS (bank sender IDs only; balances removed on the phone, OTPs ignored).
- One general reader for all Indian banks (`lib/sms/parse.ts`): amount, payee, date, UPI ref, account digits. Optional AI fallback for unknown formats.
- Auto-categorises from shop names; detects transfers to your own name and money coming in; skips duplicates by UPI ref.
- Unknown payees ask once in the notification ("Chai / snacks · Auto / travel · Paid back / lent"); Flow remembers per payee and amount range.
- "To review" card on Expenses; Profile → Bank SMS: on/off, accounts found (switch each off), learned payees (forget any).
- Editing an SMS-added expense also teaches Flow that payee.
- New: `models/PayeeRule.ts`, `/api/sms/ingest|resolve|review|settings`. Expense gains `source`, `smsRef`, `payee`, `account`, `needsReview`.

# Flow update — Recovery codes and admin reset links

- Forgot password now uses a **recovery code** (Profile → Security → Recovery code). Enter email + code + new password; the used code is replaced with a new one. 5 wrong tries lock recovery for 15 minutes.
- **Admin reset link** (Profile → Admin, only for emails in `ADMIN_EMAILS`): make a one-time 24-hour link for someone who lost their code, and send it on WhatsApp.
- Email reset (Resend) is kept but hidden. Turn it back on with `PASSWORD_RESET_EMAIL=on` once `EMAIL_FROM` uses a verified domain.
- New routes: `/api/auth/recover`, `/api/account/recovery-code`, `/api/admin/reset-link`.

# Flow update — Password reset and a real Profile

## Added

- Forgot password: "Forgot password?" on sign-in → email link (30 min, one-time use) → choose a new password. Resetting signs out every device. Needs `RESEND_API_KEY` + `EMAIL_FROM` on Vercel.
- Profile sheet with sections: About you (edit name, choose what Flow calls you), Preferences (roasts on/off, Savings/Investments tab, remove custom categories), Security (change password, change email, sign out of other devices), Your data (CSV export, delete account).
- New API routes: `/api/auth/forgot`, `/api/auth/reset`, `/api/account` (PATCH profile, DELETE account), `/api/account/password`, `/api/account/email`, `/api/account/sessions`.
- New model `models/PasswordReset.ts` (only token hashes are stored; documents auto-expire).

## Changed

- Removed the Bhai / Yaar / Behen picker. Flow now uses your nickname, or your first name if you leave it blank, in greetings, roasts and reminders.
- AI roasts only get a nickname you chose yourself, never your real name. With no nickname the AI is told not to use bhai/yaar/behen.
- With roasts turned off, there are no roast pop-ups or overspend notifications. Praise and insights still show.

No manual MongoDB migration is needed.

# Flow update — Savings, cleaner expenses, and personalization

## Added

- Savings as a first-class money view alongside Investments.
- Automatic second-navigation label: Savings or Investments based on the user's saved preference.
- Smart fallback: users with no existing investments default to Savings; existing investors without a preference keep Investments.
- Savings activity types: Opening balance, Save/Deposit, Account transfer, Withdrawal/Use.
- Derived savings account balances from activity.
- Account-to-account transfers are neutral and never inflate total savings.
- Savings account filtering, period summaries, search, and 5-item pagination.
- User-specific custom expense categories stored on the user's account.
- Business-friendly standard categories including Inventory / Stock, Office & Supplies, Marketing, and Professional Fees.
- More payment methods including IMPS, NEFT, RTGS, Business Account, and Personal Account.
- CSV export now includes savings activity.

## Improved

- Recent expenses show only five records per page with compact pagination.
- Expense descriptions are secondary small text instead of competing with the category/amount.
- Quick expense category chips prioritize the user's actual/current categories before defaults.
- Search includes more expense metadata.
- More whitespace and quieter controls for the new functionality.

## New backend files

- `models/Saving.ts`
- `app/api/savings/route.ts`
- `app/api/savings/[id]/route.ts`
- `app/api/preferences/route.ts`

MongoDB does not require a manual migration for these additions; the new savings collection and new optional user fields are created as they are used.
