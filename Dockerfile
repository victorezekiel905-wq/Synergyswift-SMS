# syntax=docker/dockerfile:1.7
# Debian, not Alpine, in every stage (as SwiftCipher's image): the live-lessons slide import
# needs LibreOffice, whose Alpine build aborts on many PowerPoint files, and native modules
# (@napi-rs/canvas, which draws PDF pages) must be built for the same C library they run on.
# ---- deps ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# ---- build ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `next build` writes NEXT_PUBLIC_* values into the pages, so they must exist while building.
# Render passes a Docker service's environment variables in as build arguments of the same name;
# each one still has to be declared here. Only browser-safe values: secrets stay runtime-only.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SSO_PROVIDERS
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_STUDENT_LOGIN_DOMAIN
ARG NEXT_PUBLIC_TIMEZONE
ARG NEXT_PUBLIC_TURN_URL
ARG NEXT_PUBLIC_TURN_USERNAME
ARG NEXT_PUBLIC_TURN_CREDENTIAL
ARG NEXT_PUBLIC_RELEASE
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  || { echo "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set before building (Render: service → Environment)." >&2; exit 1; }
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
# LibreOffice turns PowerPoint (and Word) uploads into PDF, so an imported deck becomes a picture
# of each slide exactly as designed. Liberation and Carlito/Caladea have the same letter widths
# as Arial, Times and Calibri/Cambria, so text wraps as it does in PowerPoint.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-impress libreoffice-writer fontconfig \
      fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core fonts-noto-core \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# svp: LibreOffice's headless drawing backend (no X server or desktop libraries needed).
ENV SAL_USE_VCLPLUGIN=svp
RUN groupadd --system app && useradd --system --gid app --create-home app
COPY --from=builder /app/public ./public
COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/supabase ./supabase
USER app
EXPOSE 3000
ENV PORT=3000
CMD ["npx","next","start"]
