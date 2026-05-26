# Multi-stage build for the Next.js frontend.
# Stage 1: install with pnpm and run `next build` (output: standalone).
# Stage 2: copy the standalone build into a minimal runtime image.

ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-alpine AS deps

RUN corepack enable pnpm
WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
# When pnpm-lock.yaml is missing (first bootstrap) we fall back to a regular install.
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile; \
    else \
      pnpm install --no-frozen-lockfile; \
    fi


FROM node:${NODE_VERSION}-alpine AS builder

RUN corepack enable pnpm
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_BUILD_STANDALONE=1
RUN pnpm build


FROM node:${NODE_VERSION}-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000 >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
