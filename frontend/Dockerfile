# Multi-stage build for the Next.js frontend.
# Stage 1: install with pnpm and run `next build` (output: standalone).
# Stage 2: copy the standalone build into a minimal runtime image.

ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-slim AS deps

RUN corepack enable pnpm
WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
# When pnpm-lock.yaml is missing (first bootstrap) we fall back to a regular install.
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile; \
    else \
      pnpm install --no-frozen-lockfile; \
    fi


FROM node:${NODE_VERSION}-slim AS builder

RUN corepack enable pnpm
WORKDIR /app

ARG INTERNAL_API_BASE_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_COMMIT_SHA

ENV INTERNAL_API_BASE_URL=${INTERNAL_API_BASE_URL} \
    NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_COMMIT_SHA=${NEXT_PUBLIC_COMMIT_SHA}

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_BUILD_STANDALONE=1
RUN pnpm build


FROM node:${NODE_VERSION}-slim AS runtime

WORKDIR /app

ARG INTERNAL_API_BASE_URL

ENV NODE_ENV=production \
    INTERNAL_API_BASE_URL=${INTERNAL_API_BASE_URL} \
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
  CMD node -e "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
