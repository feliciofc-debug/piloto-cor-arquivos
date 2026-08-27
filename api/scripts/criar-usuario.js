const path = require('node:path');
const argon2 = require('argon2');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const papeisValidos = new Set(['operador', 'gestor', 'admin']);

function parseArgs(argv) {
  const args = {};

  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      continue;
    }

    const key = item.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function usage() {
  return [
    'Uso:',
    '  node scripts/criar-usuario.js --email operador@cor.rio --nome "Operador COR" --papel operador --senha "SenhaForte"',
    '',
    'Papeis validos: operador, gestor, admin',
  ].join('\n');
}

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

async function main() {
  const args = parseArgs(process.argv);

  if (args.help || args.h) {
    console.log(usage());
    return;
  }

  const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : '';
  const nome = typeof args.nome === 'string' ? args.nome.trim() : '';
  const papel = typeof args.papel === 'string' ? args.papel.trim() : '';
  const senha = typeof args.senha === 'string' ? args.senha : '';

  if (!email || !nome || !papel || !senha) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (!papeisValidos.has(papel)) {
    console.error(`Papel invalido: ${papel}`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const senhaHash = await argon2.hash(senha, {
    type: argon2.argon2id,
  });

  const client = createClient();
  await client.connect();

  try {
    const result = await client.query(
      `insert into usuarios (email, nome, papel, senha_hash)
       values ($1, $2, $3, $4)
       returning id, email, nome, papel`,
      [email, nome, papel, senhaHash],
    );

    console.log('Usuario criado:');
    console.log(JSON.stringify(result.rows[0], null, 2));
  } catch (error) {
    if (error.code === '23505') {
      console.error(`Ja existe usuario com e-mail ${email}`);
      process.exitCode = 1;
      return;
    }

    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('FALHA ao criar usuario');
  console.error(error);
  process.exitCode = 1;
});
