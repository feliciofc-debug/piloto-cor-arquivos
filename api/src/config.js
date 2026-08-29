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
  analiseTimeoutMinutes: Number(env('ANALISE_TIMEOUT_MINUTES', '10')),
  visionProvider: env('VISION_PROVIDER', 'lovable'),
  visionModel: env('VISION_MODEL', 'google/gemini-2.5-pro'),
  visionApiKey: env('VISION_API_KEY'),
  visionApiBaseUrl: env('VISION_API_BASE_URL', 'https://ai.gateway.lovable.dev/v1').replace(/\/$/, ''),
  visionApiPath: env('VISION_API_PATH', '/chat/completions'),
  visionTimeoutMs: Number(env('VISION_TIMEOUT_MS', '60000')),
  visionMaxFrames: Number(env('VISION_MAX_FRAMES', '40')),
  whatsappPhoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
  whatsappToken: env('WHATSAPP_TOKEN'),
  whatsappDestino: env('WHATSAPP_DESTINO'),
  whatsappAtivo: boolEnv('WHATSAPP_ATIVO', false),
  whatsappTimeoutMs: Number(env('WHATSAPP_TIMEOUT_MS', '10000')),
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

  if (!Number.isInteger(config.visionTimeoutMs) || config.visionTimeoutMs <= 0) {
    throw new Error('VISION_TIMEOUT_MS precisa ser um numero inteiro positivo.');
  }

  if (!Number.isInteger(config.visionMaxFrames) || config.visionMaxFrames <= 0) {
    throw new Error('VISION_MAX_FRAMES precisa ser um numero inteiro positivo.');
  }

  if (!Number.isInteger(config.whatsappTimeoutMs) || config.whatsappTimeoutMs <= 0) {
    throw new Error('WHATSAPP_TIMEOUT_MS precisa ser um numero inteiro positivo.');
  }

  if (config.whatsappAtivo) {
    required('WHATSAPP_PHONE_NUMBER_ID');
    required('WHATSAPP_TOKEN');
    required('WHATSAPP_DESTINO');
  }
}

module.exports = {
  config,
  assertServerConfig,
};
