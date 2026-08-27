const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const twelveHoursInSeconds = 12 * 60 * 60;

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function boolEnv(name, fallback) {
  const value = env(name, fallback ? 'true' : 'false');
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function required(name) {
  const value = env(name);
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

const config = {
  nodeEnv: env('NODE_ENV', 'development'),
  host: env('HOST', '0.0.0.0'),
  port: Number(env('PORT', '8091')),
  databaseUrl: env('DATABASE_URL_API', env('DATABASE_URL')),
  jwtSecret: env('JWT_SECRET'),
  cookieName: env('COOKIE_NAME', 'cor_session'),
  cookieSecure: boolEnv('COOKIE_SECURE', env('NODE_ENV', 'development') === 'production'),
  sessionTtlSeconds: Number(env('SESSION_TTL_SECONDS', String(twelveHoursInSeconds))),
  loginRateLimitMax: Number(env('LOGIN_RATE_LIMIT_MAX', '5')),
  loginRateLimitWindow: env('LOGIN_RATE_LIMIT_WINDOW', '1 minute'),
};

function assertServerConfig() {
  required('JWT_SECRET');

  if (!config.databaseUrl) {
    throw new Error('Configure DATABASE_URL_API para a API ou DATABASE_URL para execucao local.');
  }

  if (!Number.isInteger(config.port) || config.port <= 0) {
    throw new Error('PORT precisa ser um numero inteiro positivo.');
  }
}

module.exports = {
  config,
  assertServerConfig,
};
