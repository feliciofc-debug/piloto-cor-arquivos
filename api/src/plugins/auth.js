const cookie = require('@fastify/cookie');
const jwt = require('@fastify/jwt');
const rateLimit = require('@fastify/rate-limit');
const fp = require('fastify-plugin');
const { config } = require('../config');
const { query } = require('../db');

const validRoles = new Set(['operador', 'gestor', 'admin']);

async function authPlugin(fastify) {
  await fastify.register(cookie);
  await fastify.register(jwt, {
    secret: config.jwtSecret,
  });
  await fastify.register(rateLimit, {
    global: false,
  });

  fastify.decorateRequest('usuario', null);

  fastify.addHook('preHandler', async (request, reply) => {
    const routeConfig = request.routeOptions.config || {};

    if (routeConfig.auth === false) {
      return;
    }

    const roles = routeConfig.roles;
    if (!Array.isArray(roles) || roles.length === 0) {
      return reply.code(403).send({ error: 'Acesso negado.' });
    }

    const invalidRole = roles.find((role) => !validRoles.has(role));
    if (invalidRole) {
      request.log.error({ role: invalidRole }, 'rota declarou papel invalido');
      return reply.code(500).send({ error: 'Configuracao invalida da rota.' });
    }

    const token = request.cookies[config.cookieName];
    if (!token) {
      return reply.code(401).send({ error: 'Sessao ausente.' });
    }

    let payload;
    try {
      payload = fastify.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: 'Sessao invalida.' });
    }

    const userId = payload.sub;
    if (!userId) {
      return reply.code(401).send({ error: 'Sessao invalida.' });
    }

    const result = await query(
      `select id, email, nome, papel, ativo
       from usuarios
       where id = $1
       limit 1`,
      [userId],
    );

    const usuario = result.rows[0];
    if (!usuario || !usuario.ativo) {
      return reply.code(401).send({ error: 'Sessao invalida.' });
    }

    if (!roles.includes(usuario.papel)) {
      return reply.code(403).send({ error: 'Acesso negado.' });
    }

    request.usuario = {
      id: usuario.id,
      email: usuario.email,
      nome: usuario.nome,
      papel: usuario.papel,
    };
  });
}

module.exports = fp(authPlugin, {
  name: 'auth-plugin',
});
