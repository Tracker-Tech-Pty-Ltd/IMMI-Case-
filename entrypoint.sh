#!/bin/sh
# Cloudflare Containers start with no working DNS resolver configured.
# Inject Cloudflare's public DNS (1.1.1.1) so outbound HTTPS works.
# *.hyperdrive.local still cannot be resolved via public DNS — that's OK
# because SupabaseRepository falls back gracefully when psycopg2 fails.
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > /etc/resolv.conf 2>/dev/null || true

exec python web.py --host 0.0.0.0 --port 8080 --backend supabase
