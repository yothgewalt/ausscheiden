#!/usr/bin/env bash
#
# Full redeploy, run ON the prod server (root@10.20.30.2):
#
#   cd /root/ausscheiden && ./deploy.sh
#
# Sequence: pull → backup → stop app → rm app → rmi app image → compose up.
#
# NOTE ON DOWNTIME. Removing the image before `up` means the rebuild happens
# while the site is down — expect ~2-3 minutes of outage, not seconds. That is
# the cost of guaranteeing nothing stale survives, which is what this sequence
# is for. If you want a near-zero-downtime deploy instead, build first and let
# compose swap the container:
#
#   git pull --ff-only && docker compose -f docker-compose.prod.yml build app \
#     && docker compose -f docker-compose.prod.yml up -d
#
# That is the right choice while tickets are actively selling; use this script
# when you want the guaranteed-clean rebuild and can afford the window.

set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
IMAGE="ausscheiden-app:latest"
APP_DIR="/root/ausscheiden"
HEALTH_URL="http://127.0.0.1:3000/api/health"

# `git pull` below rewrites this very file. Bash reads a script incrementally,
# so a mid-run rewrite can make it execute garbage. Re-exec from a copy first.
if [ "${DEPLOY_REEXEC:-}" != "1" ]; then
  cp "$0" /tmp/ausscheiden-deploy.sh
  DEPLOY_REEXEC=1 exec bash /tmp/ausscheiden-deploy.sh "$@"
fi

cd "$APP_DIR"

# ── 0. Fail fast on the things that make a deploy unrecoverable ──────────────
# docker-compose.prod.yml declares ADMIN_TOKEN as ${ADMIN_TOKEN:?}, so a missing
# value aborts `up` AFTER the old container is already gone. Catch it here,
# while the site is still serving.
if ! grep -q '^ADMIN_TOKEN=' .env; then
  echo "ABORT: ADMIN_TOKEN missing from .env — compose would refuse to start and" >&2
  echo "       the site would stay down. Add it, then re-run." >&2
  exit 1
fi

# BOOKING_CLOSES_AT is ${BOOKING_CLOSES_AT:-} in compose — unset is a VALID state
# meaning "booking never closes", so this warns rather than aborts. It exists
# because that is the one setting whose absence is invisible: the deploy
# succeeds, the site looks right, and nothing closes on the deadline.
if ! grep -q '^BOOKING_CLOSES_AT=' .env; then
  echo "WARNING: BOOKING_CLOSES_AT not in .env — public booking will NEVER close." >&2
  echo "         Set it (e.g. 2026-09-01T00:00:00+07:00, offset required) if that" >&2
  echo "         is not what you want, then re-run." >&2
fi

echo "==> 1/6  pulling"
git pull --ff-only

echo "==> 2/6  backing up the database"
# The container runs drizzle-kit push on boot, so every deploy can touch the
# schema. 8 real bookings live in here; the dump costs a second.
mkdir -p /root/backups
BACKUP="/root/backups/predeploy-$(date +%Y%m%d-%H%M%S).sql"
docker exec ausscheiden-postgres-1 pg_dump -U ausscheiden -d ausscheiden > "$BACKUP"
echo "    $BACKUP ($(wc -l < "$BACKUP") lines)"

echo "==> 3/6  stopping app"
$COMPOSE stop app

echo "==> 4/6  removing app container"
$COMPOSE rm -f app

echo "==> 5/6  removing app image"
# `|| true`: a first run, or an already-pruned image, must not abort the deploy.
docker rmi -f "$IMAGE" || true

echo "==> 6/6  bringing everything up (rebuilds the missing image)"
$COMPOSE up -d

echo "==> waiting for health"
for i in $(seq 1 180); do
  if curl -sf -o /dev/null "$HEALTH_URL"; then
    echo "    app answering after ${i}s"
    break
  fi
  if [ "$i" -eq 180 ]; then
    echo "ABORT: app did not answer within 180s. Recent logs:" >&2
    $COMPOSE logs app --tail 40 >&2
    echo "Restore with: docker exec -i ausscheiden-postgres-1 psql -U ausscheiden -d ausscheiden < $BACKUP" >&2
    exit 1
  fi
  sleep 1
done

echo "==> verifying"
$COMPOSE ps
printf '    public /          -> '; curl -sk -o /dev/null -w '%{http_code}\n' https://elite.fitm.kmutnb.ac.th/
printf '    public /backoffice-> '; curl -sk -o /dev/null -w '%{http_code}\n' https://elite.fitm.kmutnb.ac.th/backoffice
printf '    admin API gated   -> '
curl -sk 'https://elite.fitm.kmutnb.ac.th/api/trpc/admin.bookings?input=%7B%7D' \
  | grep -qo UNAUTHORIZED && echo "UNAUTHORIZED (correct)" || echo "!! NOT GATED — investigate"
printf '    bookings in db    -> '
docker exec ausscheiden-postgres-1 psql -U ausscheiden -d ausscheiden -t -A -c 'SELECT count(*) FROM bookings;'

echo
echo "done. backup: $BACKUP"
