#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
fi

DOMAIN="${DOMAIN:-piloto.atombrasildigital.com}"

if [ -z "${LETSENCRYPT_EMAIL:-}" ]; then
  echo "Configure LETSENCRYPT_EMAIL no .env antes de emitir o certificado." >&2
  exit 1
fi

cd "$ROOT_DIR"

docker compose run --rm --entrypoint sh certbot -c "
  if [ -f '/etc/letsencrypt/live/${DOMAIN}/.fallback' ]; then
    rm -rf '/etc/letsencrypt/live/${DOMAIN}' \
           '/etc/letsencrypt/archive/${DOMAIN}' \
           '/etc/letsencrypt/renewal/${DOMAIN}.conf';
  fi
"

docker compose run --rm certbot certonly \
  --webroot \
  -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$LETSENCRYPT_EMAIL" \
  --agree-tos \
  --no-eff-email

docker compose exec nginx nginx -s reload
