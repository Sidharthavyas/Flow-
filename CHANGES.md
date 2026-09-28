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
