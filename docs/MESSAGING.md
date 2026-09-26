# Email, WhatsApp, SMS and app notifications

Every message to a parent (results, sign-in and sign-out, pickup codes, fees, absences, behaviour, sick bay, bus, exeat, events, meetings, admissions, staff messages, wallet, broadcasts and library reminders) is first written to the `message_outbox` table. It is then sent immediately inside the same request, so parents usually receive it within seconds. Anything that cannot be sent right away is retried by the cron worker with backoff (2, 4, 8 and 16 minutes, five attempts). Nothing is silently dropped. Every row keeps its status and the provider's error, and school admins see this on **Messages**.

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
| App push | Web Push (VAPID), free | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |

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

**`WHATSAPP_TPL_MESSAGE`**
```
{{1}}: {{2}} sent you a message about "{{3}}". Read and reply: {{4}}
```

**`WHATSAPP_TPL_WALLET`**
```
{{1}}: {{3}} was added to {{2}}'s school wallet. New balance: {{4}}.
```

**`WHATSAPP_TPL_WALLET_LOW`**
```
{{1}}: {{2}}'s school wallet balance is down to {{3}}. Top up here: {{4}}
```

**`WHATSAPP_TPL_BUS_NEAR`**
```
{{1}}: the {{2}} bus is about 5 minutes from {{3}}. This alert is for {{4}}.
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

## App push notifications

Push notifications cost nothing per message, so they go to every device where a parent or member of staff turned them on, alongside their other channels.

1. Run `npx web-push generate-vapid-keys` once and set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (for example `mailto:ops@your-company.com`). Keep the private key secret, and never change the keys, or every device must turn notifications on again.
2. Parents tap **Turn on** under **Notifications and language** in their portal, on each phone or computer. This works for signed-in parents and for the private WhatsApp link.
3. Staff get a push for new parent messages and cover duties. Without a device registered, they get an email instead.

A device that uninstalls the app or blocks notifications is removed automatically the next time a push fails. On iPhone, push works once the app has been added to the home screen (iOS 16.4 and later).

## Two-way parent messaging

Parents and staff message each other inside the app (**Parent messages** for staff, the **Messages** tab in the parent portal). Phone numbers are never shared.

- Teachers can only start a conversation with families of students they teach. Parents can write to their child's teachers or to the school office. School admins can read every thread, for safeguarding.
- Messages cannot be edited or deleted, so the record is permanent.
- The other side is told by push, email or WhatsApp (`WHATSAPP_TPL_MESSAGE`). The WhatsApp message carries a link to read and reply, not the message itself.
- Parents are limited to 30 messages an hour and 10 new conversations a day.

## Translation for parents

Each parent can choose a home language in their portal, or staff can set it on the student's record. The school sets its own language under **School setup → Profile**.

- **Broadcasts** are translated once per language and each family receives its own version. Turn this off per broadcast with the **Translate** tick box.
- **Messages** are translated both ways: parents read staff messages in their language, and staff read parents' replies in the school's language. The original is always one tap away.
- Names, dates, amounts, codes and links are kept exactly as written.
- Translation uses Claude and needs `ANTHROPIC_API_KEY`. If it is missing or a translation fails, the original text is sent.

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
