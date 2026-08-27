const { query } = require('../db');

async function healthRoutes(fastify) {
  fastify.get('/health', {
    config: {
      auth: false,
    },
  }, async (request, reply) => {
    try {
      await query('select 1 as ok');
      return reply.send({
        status: 'ok',
        database: 'ok',
      });
    } catch (error) {
      request.log.error({ err: error }, 'healthcheck de banco falhou');
      return reply.code(503).send({
        status: 'error',
        database: 'error',
      });
    }
  });
}

module.exports = healthRoutes;
