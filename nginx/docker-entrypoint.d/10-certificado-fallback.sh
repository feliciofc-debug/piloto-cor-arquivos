#!/bin/sh
set -eu

DOMAIN="${DOMAIN:-piloto.atombrasildigital.com}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
FULLCHAIN="${CERT_DIR}/fullchain.pem"
PRIVKEY="${CERT_DIR}/privkey.pem"
MARKER="${CERT_DIR}/.fallback"

if [ -s "$FULLCHAIN" ] && [ -s "$PRIVKEY" ]; then
  exit 0
fi

mkdir -p "$CERT_DIR"

openssl req \
  -x509 \
  -nodes \
  -newkey rsa:2048 \
  -days 1 \
  -keyout "$PRIVKEY" \
  -out "$FULLCHAIN" \
  -subj "/CN=${DOMAIN}"

touch "$MARKER"
