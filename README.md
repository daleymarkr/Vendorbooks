# VendorBooks

VendorBooks is a ledger for shops that sell other people's goods on Square: antique malls, consignment shops, and maker co-ops. It reads your Square catalog and sales, tags each item to a vendor, applies that vendor's commission and booth rent, and prepares a monthly statement. You pay the vendor by check, ACH, or Zelle. VendorBooks records that you did. It does not hold, receive, or send that money.

You can click through a full sample mall on your own computer before you create any Square, Stripe, or Supabase account.

## Try the sample mall

You need Node.js 22. Then, in this folder:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

On the sign-in page, every sample account uses the password `ledger`.

| Email | What you see |
| --- | --- |
| marina@harborpine.demo | Harbor & Pine, the shop owner |
| sam@harborpine.demo | The same shop, as the bookkeeper |
| alice@vendors.demo | Alice's read-only vendor portal |
| mark@vendorbooks.demo | The platform admin list of shops |

Walk the owner account through **Unassigned**, **Monthly close**, and a statement. The sample already contains the worked examples from the build spec: a $100 sale for Alice (tax and tip left out, vendor amount $60), an order discount split between Alice and Bob, Bob's booth rent that ends the month negative, and a refund that lands in the next month because October was already approved.

`npm test` runs the payout math, webhook signature checks, plan limits, and a scan that the screens do not use money-movement language.

Nothing in demo mode calls Square, Stripe, or Resend. Emails are written to an in-app log. The sample database is a file named `.data/demo-db.json`. **Reset demo ledger** on Settings throws that file away and loads the sample again. Demo mode is for learning the product on your machine. Do not point a public website at it.

## How the pieces fit

The website and all of the HTTP jobs run as one Next.js app. The supported place to host it is Vercel.

- The browser talks to Next.js.
- Shop data, sign-in, and statement files live in Supabase (Postgres, Auth, row-level security, a private Storage bucket).
- Square is read-only: OAuth, orders, catalog, payments. Webhooks hit `https://YOUR-DOMAIN/api/square/webhook`.
- Stripe bills the shop for VendorBooks. It does not pay vendors.
- Resend sends statement and billing email.
- Vercel Cron calls `/api/cron/*` once a day. The secret is `CRON_SECRET`.

`supabase/functions/` has the same jobs for a Supabase deploy. The Square webhook function runs the shared verifier. The others forward to the Next.js routes when `APP_URL` is set. You do not need to deploy those functions to launch. Vercel Cron plus the `/api` routes are enough.

## 1. Square sandbox

Do this before you connect a real store. Sandbox money is fake.

1. Go to [developer.squareup.com](https://developer.squareup.com) and sign in.
2. Open **Sandbox test accounts**. Launch the sandbox seller dashboard once and leave that browser tab around. Square wants the sandbox seller open before you approve an app.
3. Create an application. Name it VendorBooks.
4. Open the app's **OAuth** settings.
   - Redirect URL for your computer: `http://localhost:3000/api/square/oauth/callback`
   - You will add the live URL later. It must match character for character, including `https://`.
5. The app asks Square for these permissions and no others: `ORDERS_READ`, `ITEMS_READ`, `ITEMS_WRITE`, `PAYMENTS_READ`, `MERCHANT_PROFILE_READ`.
6. Copy the **Sandbox** application ID and application secret into `.env.local` (see the list below). Production ID and secret are a different pair. Keep them in the `SQUARE_PRODUCTION_*` variables and leave `SQUARE_ENV=sandbox` until you are ready.
7. Open **Webhooks**. Add a subscription.
   - Notification URL, on your computer, only works if you use a tunnel. For the first real test, use the Vercel URL from the deploy section: `https://YOUR-DOMAIN/api/square/webhook`
   - Subscribe to: `order.created`, `order.updated`, `payment.updated`, `refund.created`, `refund.updated`, `catalog.version.updated`, `oauth.authorization.revoked`.
8. Copy the **signature key**. Sandbox and production each have their own key. Put the sandbox key in `SQUARE_WEBHOOK_SIGNATURE_KEY`. The notification URL you typed into Square must be exactly `SQUARE_WEBHOOK_NOTIFICATION_URL`. Square signs `notification URL + raw body`. If one character differs, every webhook is rejected.
9. In the sandbox seller dashboard, add a location and a few items. You can sell them from the sandbox point of sale or the API. VendorBooks will pull them after you connect.

Square details the app already follows:

- OAuth is the server code flow, not PKCE. The access token lasts about 30 days. The refresh token from this flow lasts until the seller disconnects. The app refreshes at least every 7 days and emails the owner if a refresh has been failing for more than 8 days.
- A vendor on a catalog item is one text field (`vendorbooks_vendor`), hidden on the POS, because a seller can only have 10 visible and 10 hidden custom fields shared by every app. If Square says the slots are full, the connect screen tells you to use SKU, category, or CSV rules instead.
- When a sale comes in, the app looks at the variation first and then the parent item. It does not assume Square copies a parent vendor onto variations.
- Order search allows 10 locations per call. The backfill and nightly reconcile split longer lists.
- Webhooks only carry an id. The app loads the full order, ignores a repeated event id, and answers Square quickly. A bad signature is rejected.

## 2. Supabase

1. Create a project at [supabase.com](https://supabase.com). Pick a region close to the shop. Save the database password somewhere safe.
2. Open **SQL Editor**, click new query, and paste the whole file `supabase/migrations/20261104000000_init.sql`. Run it. That creates the tables, the plan-limit triggers, row-level security, and a private `statements` storage bucket.
3. If you prefer the Supabase CLI later: install it, run `supabase link`, then `supabase db push`. The SQL file is the same either way.
4. Open **Project Settings → API**. Copy the project URL, the `anon` key, and the `service_role` key. The service role key bypasses row-level security. It stays on the server. Never put it in a `NEXT_PUBLIC_` variable.
5. Open **Authentication → URL configuration**. Set the site URL to `http://localhost:3000` while you are testing, and add `http://localhost:3000/auth/callback`. You will change these to the live domain before launch.
6. Authentication → Providers → Email can stay on. For a local project you can turn off "Confirm email" so you are not waiting on an inbox. Turn it on for production if you want that extra check.
7. After you create your own login, make yourself the platform admin. In the SQL editor:

```sql
update public.profiles
set is_platform_admin = true
where email = 'you@yourdomain.com';
```

The same address in `PLATFORM_ADMIN_EMAILS` is promoted on the next sign-in as well.

## 3. Stripe

VendorBooks uses Stripe Checkout and the Customer Portal. It does not use Square to bill the shop.

In the Stripe dashboard, create four recurring prices. The amounts have to be exact. Checkout refuses a price that does not match, because the annual plan is defined as ten times the monthly price (two months included).

| Price | Amount | Env variable |
| --- | --- | --- |
| Shop monthly | $49.00 USD, billed every month | `STRIPE_PRICE_SHOP_MONTHLY` |
| Shop annual | $490.00 USD, billed every year | `STRIPE_PRICE_SHOP_ANNUAL` |
| Mall monthly | $129.00 USD, billed every month | `STRIPE_PRICE_MALL_MONTHLY` |
| Mall annual | $1,290.00 USD, billed every year | `STRIPE_PRICE_MALL_ANNUAL` |

Copy each price's `price_...` id.

Turn on the Customer Portal (Settings → Billing → Customer portal) so an owner can update a card and cancel.

Add a webhook endpoint:

- URL: `https://YOUR-DOMAIN/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`
- Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

The 14-day trial is applied by the app when checkout starts. You do not have to put a trial on the Stripe price. A failed invoice sets a 3-day grace period, emails the owner, and then makes the shop read-only until the card works again. Read-only still shows the ledger.

Free plan: 5 active vendors, 1 location. Shop: 50 vendors, multiple locations. Mall: unlimited vendors, multiple locations. Going over the limit does not delete data. It blocks new vendors, extra locations, and monthly close until you archive someone or upgrade.

## 4. Resend

1. Create an account at [resend.com](https://resend.com).
2. Add your domain and turn on the SPF and DKIM records they show you. Wait until the domain says verified.
3. Create an API key. Put it in `RESEND_API_KEY`.
4. Choose the from address, for example `statements@yourdomain.com`, and set `RESEND_FROM_EMAIL`.

Until the key is present, VendorBooks keeps the email text in the `email_log` table and does not try to send it. That is what the sample mall does.

Emails: portal invite, statement ready, trial ending about three days before the trial ends, failed subscription payment, and a note when Square token refresh has been failing for more than eight days.

## 5. Fill in `.env.local`

```bash
cp .env.example .env.local
```

Generate two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Use the first as `TOKEN_ENCRYPTION_KEY` and the second as `APP_SECRET`. Do not invent a short password for these. The encryption key is what locks Square tokens in the database.

Then set:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
DEMO_MODE=false
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
TOKEN_ENCRYPTION_KEY=...
APP_SECRET=...
PLATFORM_ADMIN_EMAILS=you@yourdomain.com
CRON_SECRET=any-long-random-string

SQUARE_ENV=sandbox
SQUARE_APPLICATION_ID=...
SQUARE_APPLICATION_SECRET=...
SQUARE_OAUTH_REDIRECT_URL=http://localhost:3000/api/square/oauth/callback
SQUARE_WEBHOOK_SIGNATURE_KEY=...
SQUARE_WEBHOOK_NOTIFICATION_URL=https://YOUR-DOMAIN/api/square/webhook

STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_PRICE_SHOP_MONTHLY=price_...
STRIPE_PRICE_SHOP_ANNUAL=price_...
STRIPE_PRICE_MALL_MONTHLY=price_...
STRIPE_PRICE_MALL_ANNUAL=price_...

RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=statements@yourdomain.com
```

`DEMO_MODE=false` with those Supabase keys uses the real database. If the Supabase keys are missing and you are not in production, the app stays in the sample mall so `npm run dev` still works.

Restart `npm run dev` after you save the file.

## 6. Deploy on Vercel

1. Push this repository to GitHub (the pull request from this project is the starting point).
2. In Vercel, import the repository. Framework is Next.js. Do not change the build command.
3. Add every variable from `.env.local`. Use the live values:
   - `NEXT_PUBLIC_APP_URL` is `https://YOUR-DOMAIN`
   - `DEMO_MODE` is `false`
   - `SQUARE_OAUTH_REDIRECT_URL` is `https://YOUR-DOMAIN/api/square/oauth/callback`
   - `SQUARE_WEBHOOK_NOTIFICATION_URL` is `https://YOUR-DOMAIN/api/square/webhook`
   - `NODE_ENV` is set by Vercel. Do not force demo mode.
4. Add `CRON_SECRET` as well. `vercel.json` schedules token refresh, nightly reconcile, monthly close, and trial emails. Vercel sends `Authorization: Bearer <CRON_SECRET>` for you when that variable exists.
5. Deploy. Open the site and create a shop.
6. Go back to Square and add the live redirect URL and webhook URL if you have not already. They must match the env values exactly.
7. In Stripe, the webhook URL must be the live `/api/stripe/webhook`.
8. In Supabase Auth URL configuration, set the site URL and `https://YOUR-DOMAIN/auth/callback`.
9. When you buy a domain, add it in Vercel, wait for the certificate, then update `NEXT_PUBLIC_APP_URL`, the Square redirect URL, the Square webhook URL, the Stripe webhook URL, and the Supabase site URL together. Redeploy after changing env vars.

Optional: set `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` to your domain to load Plausible. The trial-complete page is `/trial/thanks` and is marked for a conversion.

## 7. First real shop

1. Sign up on the live site. You land on Free: 5 vendors, 1 location.
2. Name the shop, pick the timezone, and pick the day of the month statements should generate (1–28). The daily job closes the previous month on that day. You can also close any month by hand.
3. Settings → billing, if you want Shop or Mall. Checkout opens Stripe. Come back to `/trial/thanks`.
4. Connect Square. Approve the sandbox seller first. Then use **Backfill orders**, **Sync catalog**, and **Create vendor attribute**.
5. Add vendors. Commission is their share of the merchandise total after discounts. Booth rent is a monthly dollar amount.
6. On Catalog, tag variations or add a SKU prefix, a category rule, or a CSV. The percent tagged is the share of variations that have a vendor attribute. Rules still apply at sale time when an item is not tagged.
7. Watch the ledger. Anything Square cannot assign sits in Unassigned. Monthly close will not approve while that queue has open rows. You can assign a vendor or mark the amount as kept by the shop.
8. Generate the month, open each statement, approve it, then record the check number or transfer confirmation after you pay the vendor yourself.
9. Invite the vendor. They get a magic link and a read-only portal. They see approved and paid statements, not drafts, and not another vendor's sales.

## Launch checklist

Do these in order when you leave the sandbox. Items that need a click in someone else's dashboard are still yours to do; the code is ready for them.

- Square production app: live redirect URL, live webhook URL, the five scopes, and the events listed above.
- Production webhook signature key stored separately from the sandbox key.
- Stripe live mode: the four prices at the amounts in the table, Customer Portal on, webhook pointing at the live URL.
- Resend domain verified (SPF and DKIM) and the from address set.
- Domain and HTTPS on Vercel. Update every URL in the same pass.
- Privacy and Terms are already published at `/privacy` and `/terms`.
- Plausible or another analytics tag via `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`, if you want it. `/trial/thanks` is the checkout success page.
- The three search pages are live: `/consignment-software-for-square`, `/vendor-mall-payouts`, `/booth-rental-tracking`, plus `/calculator`.
- Your user has `is_platform_admin = true`.
- `CRON_SECRET` is set so the four scheduled jobs run.
- In Supabase, confirm the `statements` bucket is private. Download a PDF while signed in, then try the same link signed out. It should not open.
- Run `npm test` on the commit you deploy.

## Security checklist

| Check | Where it lives |
| --- | --- |
| A member only reads their shop | Row-level policies in the migration, plus the server checks the membership before it queries |
| A vendor cannot read another vendor | `statements_portal_select` and `ledger_portal_select` allow only that vendor's rows, and only approved or paid statements |
| Nobody signed in can read Square tokens | `square_connections` has row-level security forced on and no policies. Grants for `anon` and `authenticated` are revoked |
| Encryption key stays on the server | `TOKEN_ENCRYPTION_KEY` is read only in server code. It is not a `NEXT_PUBLIC_` variable |
| Square webhooks | HMAC of the notification URL plus the raw body, compared without returning early |
| Stripe webhooks | `stripe.webhooks.constructEvent` |
| Seller disconnects the app | `oauth.authorization.revoked` deletes tokens, catalog cache, locations, and Square-derived ledger lines |
| No Square passwords | Connect is OAuth only |
| Privacy and Terms | `/privacy` and `/terms`, including delete-on-revoke and the shop-pays-vendors rule |
| Plan limits | Checked in the app and again by database triggers on vendors, locations, and new statements |
| OAuth state and portal links | Signed, expiring tokens. Supabase magic links when Supabase Auth is on |

## Decisions that were not pinned down in the spec

- The app is Next.js on Vercel. Supabase is the database, auth, storage, and row-level security. Scheduled jobs are Vercel Cron. Edge function files are included and share the webhook code, but they are not required to launch.
- Tax and tips are **not** inside Square's gross merchandise amount. The default base is gross minus the discount Square already split onto the line. Tax and tips are added only if you turn that on. That matches the $100 sale with $8 tax staying a $100 base.
- Commission is banker's rounding (half to even) on exact integer cents.
- Square processing fees are split across lines by the largest-remainder method so the shares add up to the fee on the payment.
- A vendor attribute stores the vendor's id, not their display name, so a rename does not untag the catalog.
- The attribute is created hidden (`VISIBILITY_HIDDEN`) so it does not use one of the seller's 10 visible slots and does not show on the POS.
- On revoke, tokens and Square-derived rows are deleted. Vendors and statements the shop already issued stay, because those are the shop's payout records.
- Refunds after an approved or paid statement become an adjustment in the next open month. They do not rewrite a statement that was already handed to the vendor.
- Service charges are excluded unless you include them or map a charge name to the shop, the base, or one vendor.
- Free-plan PDFs carry a light "VendorBooks Free" watermark.
- Owner, manager, and bookkeeper: owners change billing, payout rules, and the Square connection. Managers run vendors, catalog, and close. Bookkeepers can record that a payment was made and can export. Vendors only read.
- While a subscription is past the 3-day grace, the shop is read-only, including recording a vendor payment. Fix the card, then record it.
- USD only. A non-USD line waits in the unassigned queue instead of being converted.

## What is still waiting on accounts

These work in code and tests, and they do nothing useful until the keys exist:

- A live Square connect, backfill, catalog attribute, and webhook delivery.
- Stripe checkout, the customer portal, and the grace-period email from a real failed invoice.
- Resend actually delivering mail. Until then the text is stored and, in the sample mall, the invite link is shown on the vendor page.
- A production domain, analytics, and the SQL update that marks your user as the platform admin.

V1 does not file 1099s, move money, write consignment contracts, or sync inventory beyond the vendor tag.
