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
  workerToken: env('WORKER_TOKEN'),
  storageDir: env('STORAGE_DIR', path.resolve(__dirname, '../../storage')),
  uploadMaxBytes: Number(env('UPLOAD_MAX_BYTES', String(100 * 1024 * 1024))),
  frameJobTimeoutMinutes: Number(env('FRAME_JOB_TIMEOUT_MINUTES', '5')),
  frameJobMaxAttempts: Number(env('FRAME_JOB_MAX_ATTEMPTS', '3')),
  frameMaintenanceIntervalMs: Number(env('FRAME_MAINTENANCE_INTERVAL_MS', '60000')),
};

function assertServerConfig() {
  required('JWT_SECRET');

  if (!config.databaseUrl) {
    throw new Error('Configure DATABASE_URL_API para a API ou DATABASE_URL para execucao local.');
  }

  if (!Number.isInteger(config.port) || config.port <= 0) {
    throw new Error('PORT precisa ser um numero inteiro positivo.');
  }

  if (!config.workerToken) {
    throw new Error('Configure WORKER_TOKEN para autenticar o worker.');
  }

  if (!Number.isFinite(config.uploadMaxBytes) || config.uploadMaxBytes <= 0) {
    throw new Error('UPLOAD_MAX_BYTES precisa ser um numero positivo.');
  }
}

module.exports = {
  config,
  assertServerConfig,
};
