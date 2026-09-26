# Email, WhatsApp and SMS delivery

Every message to a parent (results, sign-in and sign-out, pickup codes, fees, absences, behaviour, sick bay, bus, exeat, events, meetings, admissions, broadcasts and library reminders) is first written to the `message_outbox` table. It is then sent immediately inside the same request, so parents usually receive it within seconds. Anything that cannot be sent right away is retried by the cron worker with backoff (2, 4, 8 and 16 minutes, five attempts). Nothing is silently dropped. Every row keeps its status and the provider's error, and school admins see this on **Messages**.

## Providers

| Channel | Provider | Variables |
|---|---|---|
| Email | Resend (default) | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` |
| Email | SendGrid | `EMAIL_PROVIDER=sendgrid`, `SENDGRID_API_KEY`, `EMAIL_FROM` |
| WhatsApp | Meta WhatsApp Cloud API (default) | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` |
| WhatsApp | Twilio | `WHATSAPP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` |
| SMS | Termii | `SMS_PROVIDER=termii`, `TERMII_API_KEY`, `SMS_SENDER_ID`, `TERMII_CHANNEL` (default `dnd`) |
| SMS | Twilio | `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` |
| SMS | Africa's Talking | `SMS_PROVIDER=africastalking`, `AT_USERNAME`, `AT_API_KEY`, optional `SMS_SENDER_ID` |

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

**`WHATSAPP_TPL_ABSENCE`**
```
{{1}}: {{2}} was marked {{3}} in class on {{4}}. If this is unexpected, please contact the school.
```

**`WHATSAPP_TPL_FEE_RECEIPT`**
```
{{1}}: we received {{2}} for {{3}}. Receipt {{4}}. Outstanding balance: {{5}}. View your invoice and receipt: {{6}}
```

**`WHATSAPP_TPL_FEE_REMINDER`**
```
{{1}}: fees for {{2}} have an outstanding balance of {{3}}, due {{4}}. Pay securely online: {{5}}
```

**`WHATSAPP_TPL_BEHAVIOUR`**
```
{{1}}: a behaviour note for {{2}}: {{3}}. Open your parent portal for details.
```

**`WHATSAPP_TPL_HEALTH`**
```
{{1}}: {{2}} was seen at the sick bay at {{3}} for {{4}}. Outcome: {{5}}.
```

**`WHATSAPP_TPL_BUS`**
```
{{1}}: {{2}} {{3}} the {{4}} bus at {{5}}.
```

**`WHATSAPP_TPL_EXEAT`**
```
{{1}}: the exeat for {{2}} {{3}} ({{4}}).
```

**`WHATSAPP_TPL_EVENT`**
```
{{1}}: {{2}} on {{3}}. Details and consent: {{4}}
```

**`WHATSAPP_TPL_MEETING`**
```
{{1}}: a parent-teacher meeting with {{2}} about {{3}} is booked for {{4}}.
```

**`WHATSAPP_TPL_ADMISSION`**
```
{{1}}: the application for {{2}} ({{3}}) {{4}}. Track it here: {{5}}
```

**`WHATSAPP_TPL_STAFF`**
```
{{1}}: {{2}}
```

When a template variable is empty, the message is sent as free text. That only reaches parents who messaged your number in the last 24 hours, so register every template before going live.

## SMS

SMS reaches parents who do not use WhatsApp, or whose WhatsApp message could not be delivered. Each school chooses a mode under **School setup → Profile → SMS**:

| Mode | What happens |
|---|---|
| Fallback (default) | When a WhatsApp message fails permanently, the same message is queued once as an SMS. |
| Always | Every WhatsApp message also goes out as an SMS. |
| Never | No automatic SMS. Parents switched to SMS individually (below) still receive it. |

A parent can also be set to receive SMS directly. Open the student's record and click the **SMS off** badge next to the parent to turn it on. That parent then gets an SMS for every notification, whatever the school's mode.

SMS text is the WhatsApp text with formatting removed, capped at 459 characters (three SMS segments). Numbers use the `phone` field first, then the WhatsApp number. The SMS rows go through the same outbox, retries and **Messages** screen as email and WhatsApp.

In Nigeria, Termii's `dnd` channel delivers to numbers on the Do-Not-Disturb list. Register your sender ID with Termii first.

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
