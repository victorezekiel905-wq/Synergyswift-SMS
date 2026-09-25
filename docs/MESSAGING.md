# Email and WhatsApp delivery

Every message to a parent (result, sign-in or sign-out alert, pickup code, broadcast, portal link, library reminder) is first written to the `message_outbox` table. It is then sent immediately inside the same request, so parents usually receive it within seconds. Anything that cannot be sent right away is retried by the cron worker with backoff (2, 4, 8 and 16 minutes, five attempts). Nothing is silently dropped. Every row keeps its status and the provider's error, and school admins see this on **Messages**.

## Providers

| Channel | Provider | Variables |
|---|---|---|
| Email | Resend (default) | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` |
| Email | SendGrid | `EMAIL_PROVIDER=sendgrid`, `SENDGRID_API_KEY`, `EMAIL_FROM` |
| WhatsApp | Meta WhatsApp Cloud API (default) | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` |
| WhatsApp | Twilio | `WHATSAPP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` |

When a channel is not configured, its messages are stored as `skipped` with the reason. Admins can retry them from **Messages** once the provider is set up.

Each school's name, colour, logo and reply-to address come from **School setup → Profile**. One platform sender number therefore serves every school, and each message is branded as that school.

## WhatsApp templates (required for reliable delivery)

WhatsApp only allows free-text messages to people who messaged your number in the last 24 hours. Results and alerts are business-initiated, so they must use **pre-approved templates**. Create these in Meta Business Manager (category **Utility**, language matching `WHATSAPP_TEMPLATE_LANG`). Then put each template name in the matching variable. With Twilio, create Content templates and use their `HX…` Content SIDs instead.

The parameters are sent in this order. Keep the placeholders exactly as numbered.

**`WHATSAPP_TPL_RESULT`**
```
Hello {{1}}, the {{2}} result for {{3}} at {{4}} is ready. Average: {{5}}. View the full report card: {{6}}
```

**`WHATSAPP_TPL_GATE`**
```
{{1}}: {{2}} signed {{3}} at {{4}} on {{5}}.
```

**`WHATSAPP_TPL_PICKUP_CODE`**
```
{{1}}: the pickup code for {{2}} is {{3}}. Valid until {{4}}. Collector: {{5}}. Share it only with the person collecting your child.
```

**`WHATSAPP_TPL_PICKUP_DONE`**
```
{{1}}: {{2}} was picked up by {{3}} at {{4}}. If you did not authorise this, call the school immediately.
```

**`WHATSAPP_TPL_BROADCAST`**
```
Message from {{1}}: {{2}}
```

**`WHATSAPP_TPL_PORTAL`**
```
{{1}}: your private parent portal for {{2}} is {{3}}. Do not forward this link.
```

**`WHATSAPP_TPL_LIBRARY`**
```
{{1}}: {{2}} has an overdue library book "{{3}}" (due {{4}}). Please help return it.
```

## Scheduling the worker

Two endpoints need a scheduler. Both require the header `Authorization: Bearer $CRON_SECRET`.

| Endpoint | How often | What it does |
|---|---|---|
| `GET /api/cron/dispatch` | every minute | Sends queued messages and retries failures |
| `GET /api/cron/daily` | once a day | Expires pickup codes, closes finished exams, sends overdue-library reminders |

Any scheduler works. Examples:

```bash
# crontab on any server
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/dispatch
0 6 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/daily
```

On Vercel Pro, add these paths to `vercel.json` crons. Vercel sends the bearer token automatically when `CRON_SECRET` is set. In Supabase, `pg_cron` with `pg_net` can call the same URLs.

## Phone numbers

Store parent numbers as typed. Local numbers such as `08031234567` get `DEFAULT_COUNTRY_CODE` (default `234`). Numbers starting with `+` or `00` are kept as international.
