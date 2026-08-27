const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const migrationsDir = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : path.resolve(__dirname, '../../db/migrations');

function createClient() {
  if (process.env.DATABASE_URL) {
    return new Client({ connectionString: process.env.DATABASE_URL });
  }

  return new Client({
    host: process.env.PGHOST || process.env.DB_HOST || process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.PGPORT || process.env.DB_PORT || process.env.POSTGRES_PORT || 5434),
    database: process.env.PGDATABASE || process.env.DB_NAME || process.env.POSTGRES_DB || 'piloto_cor',
    user: process.env.PGUSER || process.env.DB_USER || process.env.POSTGRES_USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
  });
}

async function listMigrationFiles() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function ensureMigrationsTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      versao text primary key,
      aplicada_em timestamptz not null default now()
    )
  `);
}

async function appliedVersions(client) {
  const result = await client.query('select versao from schema_migrations');
  return new Set(result.rows.map((row) => row.versao));
}

async function applyMigration(client, fileName) {
  const filePath = path.join(migrationsDir, fileName);
  const sql = await fs.readFile(filePath, 'utf8');

  await client.query('begin');

  try {
    await client.query(sql);
    await client.query(
      'insert into schema_migrations (versao) values ($1)',
      [fileName],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function main() {
  const client = createClient();
  await client.connect();

  try {
    await client.query("select pg_advisory_lock(hashtext('piloto_cor_migrations'))");
    await ensureMigrationsTable(client);

    const applied = await appliedVersions(client);
    const files = await listMigrationFiles();

    if (files.length === 0) {
      console.log(`Nenhuma migração encontrada em ${migrationsDir}`);
      return;
    }

    for (const fileName of files) {
      if (applied.has(fileName)) {
        console.log(`SKIP ${fileName}`);
        continue;
      }

      console.log(`APPLY ${fileName}`);
      await applyMigration(client, fileName);
      console.log(`OK ${fileName}`);
    }
  } finally {
    await client
      .query("select pg_advisory_unlock(hashtext('piloto_cor_migrations'))")
      .catch(() => {});
    await client.end();
  }
}

main().catch((error) => {
  console.error('FALHA ao aplicar migrações');
  console.error(error);
  process.exitCode = 1;
});
