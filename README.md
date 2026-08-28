# Piloto COR

## Produção com Nginx e TLS

Depois de atualizar a VPS:

```bash
cd /opt/piloto-cor
git pull
```

Garanta no `.env`:

```env
COOKIE_SECURE=true
DOMAIN=piloto.atombrasildigital.com
LETSENCRYPT_EMAIL=seu-email@dominio.com
NGINX_CLIENT_MAX_BODY_SIZE=100m
```

Suba os serviços. Na primeira subida o Nginx cria um certificado temporário,
apenas para conseguir iniciar antes da emissão real pelo Let's Encrypt.

```bash
docker compose up -d --build
```

Emita o certificado real:

```bash
./scripts/emitir-certificado.sh
```

Renovação recomendada no cron da VPS:

```cron
30 3 * * * cd /opt/piloto-cor && docker compose run --rm certbot renew --webroot -w /var/www/certbot --quiet && docker compose exec nginx nginx -s reload >> /opt/piloto-cor/backups/postgres/certbot-renew.log 2>&1
```

## Backup e restauração

O backup diário do Postgres é gerado por:

```bash
./scripts/backup-postgres.sh
```

Por padrão, os arquivos ficam em:

```text
/opt/piloto-cor/backups/postgres
```

O formato é custom do Postgres (`pg_dump -Fc`), adequado para restauração com
`pg_restore`.

### Teste de restauração

Use um banco separado para testar a restauração sem tocar no banco de produção:

```bash
cd /opt/piloto-cor
set -a && source .env && set +a
BACKUP_FILE="$(ls -1t /opt/piloto-cor/backups/postgres/piloto_cor_*.dump | head -n 1)"
RESTORE_DB=piloto_cor_restore

docker compose exec -T db dropdb -U "$POSTGRES_USER" --if-exists "$RESTORE_DB"
docker compose exec -T db createdb -U "$POSTGRES_USER" "$RESTORE_DB"
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$RESTORE_DB" < "$BACKUP_FILE"
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$RESTORE_DB" -c '\dt'
```

Se a listagem de tabelas aparecer, o arquivo foi gerado e restaurado com
sucesso.

Cron diário recomendado:

```cron
15 3 * * * cd /opt/piloto-cor && ./scripts/backup-postgres.sh >> /opt/piloto-cor/backups/postgres/backup.log 2>&1
```
