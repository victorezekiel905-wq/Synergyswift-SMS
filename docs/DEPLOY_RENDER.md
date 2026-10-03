# Hosting on Render

This guide puts EduClass Fusion online on [Render](https://render.com), with the database on Supabase. Allow about two hours, plus a few days for WhatsApp template approval.

The repository already contains a Render Blueprint ([`render.yaml`](../render.yaml)). It creates three things:

| Render service | What it is | Plan |
|---|---|---|
| `educlass-fusion` | The web app | Starter ($7/month). The free plan sleeps after 15 minutes idle, so the first parent each morning would wait about a minute. |
| `educlass-dispatch` | Scheduled job, every minute: sends queued messages and retries failures | Starter cron (billed by the minute it runs, about $1/month) |
| `educlass-daily` | Scheduled job, 06:00 Lagos time: expires pickup codes, closes finished exams, sends library reminders | Starter cron |

Check current prices on render.com/pricing before you start.

## 1. Prepare the database (Supabase)

1. Open your Supabase project. Note its region under **Project Settings → General**. For West Africa, Frankfurt (eu-central-1) is a good choice; the Blueprint puts the app in Render's Frankfurt region to match. If your project is elsewhere, change `region:` in `render.yaml` to the closest Render region.
2. Open **SQL editor** and run every file in `supabase/migrations` **in name order**, one at a time. All of them are safe to run again.
3. Under **Authentication → Providers**, keep Email on. Under **Authentication → Multi-Factor**, keep TOTP (authenticator app) enabled.
4. Under **Authentication → URL Configuration**, set **Site URL** to your app address (step 2 gives you one) and add `https://YOUR-APP/**` to **Redirect URLs**.
5. Under **Project Settings → API**, copy the **Project URL**, the **anon public** key and the **service_role** key. Keep the service_role key secret: it bypasses all school isolation.
6. Turn on **Point-in-time recovery** (Database → Backups) once real schools are using it.

## 2. Create the services on Render

1. Sign in to Render with the GitHub account that owns `victorezekiel905-wq/Synergyswift-SMS`.
2. Choose **New → Blueprint**, select the repository, and confirm the `main` branch.
3. Render lists the three services and asks for the values marked as secret. Fill in at least:

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
| `NEXT_PUBLIC_APP_URL` | `https://educlass-fusion.onrender.com` for now (Render shows the exact name), or your own domain later |

   The others (email, WhatsApp, Paystack, SMS, push notifications, drafting) can be left empty and added later under the service's **Environment** tab. Features without keys simply stay off.
   `CRON_SECRET` is generated automatically and shared with the two scheduled jobs.
4. Click **Apply**. The first build takes 3 to 6 minutes. When the web service shows **Live**, open its URL: you should see the sign-in page.
5. Check health: `https://YOUR-APP/api/status` should return `{"ok":true,…}`. If it says `ok: false`, the Supabase URL or keys are wrong.

Every push to `main` on GitHub now redeploys automatically.

## 3. Make yourself super admin

On your own computer, in the project folder, create `.env.local` with the three Supabase values and `NEXT_PUBLIC_APP_URL`, then run:

```bash
node --env-file=.env.local scripts/make-platform-admin.mjs you@yourcompany.com
```

Open the printed link, set a password, then sign in. You will be asked to set up an authenticator app; super admins must use one. You then land on **/platform**, where you create the first school.

## 4. Add the services one by one

Add each key in Render under **educlass-fusion → Environment**, then **Save, rebuild and deploy**.

| Feature | Keys | Notes |
|---|---|---|
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | Verify your sending domain in Resend first. |
| WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and each `WHATSAPP_TPL_*` | Register the templates in [MESSAGING.md](MESSAGING.md) in Meta Business Manager. Approval takes days, so start early. |
| SMS | `TERMII_API_KEY`, `SMS_SENDER_ID` | Register the sender ID with Termii. |
| Online fees and wallet top-ups | `PAYSTACK_SECRET_KEY` | In Paystack, set the webhook URL to `https://YOUR-APP/api/pay/webhook/paystack`. Each school enters its own subaccount code under **Fees → Online payments**. |
| App notifications | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Run `npx web-push generate-vapid-keys` once. Never change these keys later. |
| Drafting and translation | `ANTHROPIC_API_KEY` | Optional. Without it the drafting buttons are hidden and messages are not translated. |

The full list of optional settings is in [`.env.example`](../.env.example).

## 5. Your own domain

1. In Render: **educlass-fusion → Settings → Custom Domains**, add e.g. `app.yourschoolbrand.com`, and create the DNS record Render shows. HTTPS is set up automatically.
2. Change `NEXT_PUBLIC_APP_URL` to the new address and redeploy (links in emails and WhatsApp messages use it).
3. Update the Supabase **Site URL** and **Redirect URLs**, and the Paystack webhook URL.

## 6. After launch

- **Scheduled jobs**: open `educlass-dispatch` in Render and check that runs succeed. A failing run means the app is down or `CRON_SECRET` does not match.
- **Uptime**: point an external monitor (Better Stack, UptimeRobot) at `/api/status`. Render's own health check uses the same address.
- **Logs**: each service has a **Logs** tab. Failed messages also appear in the app under **Messages**.
- **Scaling**: if pages slow down at busy times (results day), move the web service to the Standard plan or add instances. Nothing else needs to change.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build fails with a Supabase error | `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing; they are needed during the build. |
| Sign-in works but every page is empty | Migrations not all applied, or applied out of order. |
| "Not found" on /platform | The account is not a super admin yet, or the authenticator step was skipped. |
| Sign-in links go to localhost | `NEXT_PUBLIC_APP_URL` or the Supabase Site URL still points to localhost. |
| Messages stuck as "queued" | The `educlass-dispatch` job is not running. |
| Payments stay "pending" | Paystack webhook URL not set, or the secret key is a test key while parents pay live. |
