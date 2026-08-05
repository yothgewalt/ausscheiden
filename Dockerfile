FROM oven/bun:1-alpine
WORKDIR /app

# Next/SWC native binaries assume glibc; alpine is musl. libc6-compat bridges it.
RUN apk add --no-cache libc6-compat

# Install ALL deps (incl. devDependencies: drizzle-kit, tailwind, typescript — needed for
# the build and the startup schema push). Don't set NODE_ENV=production yet or Bun skips devDeps.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# NEXT_PUBLIC_WS_URL is inlined into the client bundle at build time (TRPCProvider.tsx).
ARG NEXT_PUBLIC_WS_URL=ws://localhost:3000/api/trpc
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN bun run build

EXPOSE 3000

# push (sync schema) -> seed (idempotent) -> start prod server. Compose gates start on
# postgres/redis being healthy, so no wait-loop is needed here.
# ponytail: single stage; the runtime needs full node_modules (custom server, no Next
# standalone) + drizzle-kit at boot, so multi-stage would prune almost nothing. Split only
# if image size becomes a real problem.
CMD ["sh", "-c", "bunx drizzle-kit push --force && bun src/server/db/seed.ts && NODE_ENV=production exec bun server.ts"]
