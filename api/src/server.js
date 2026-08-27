const Fastify = require('fastify');
const { assertServerConfig, config } = require('./config');
const { closePool } = require('./db');
const authPlugin = require('./plugins/auth');
const authRoutes = require('./routes/auth');
const healthRoutes = require('./routes/health');

async function buildServer() {
  assertServerConfig();

  const fastify = Fastify({
    logger: true,
    trustProxy: true,
  });

  fastify.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'erro nao tratado');
    reply.code(error.statusCode || 500).send({
      error: error.statusCode ? error.message : 'Erro interno.',
    });
  });

  await fastify.register(authPlugin);
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);

  return fastify;
}

async function start() {
  const fastify = await buildServer();

  const shutdown = async () => {
    fastify.log.info('encerrando api');
    await fastify.close();
    await closePool();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await fastify.listen({
    host: config.host,
    port: config.port,
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildServer,
};
