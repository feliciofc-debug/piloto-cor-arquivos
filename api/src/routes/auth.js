const argon2 = require('argon2');
const { config } = require('../config');
const { query } = require('../db');

function publicUser(usuario) {
  return {
    id: usuario.id,
    email: usuario.email,
    nome: usuario.nome,
    papel: usuario.papel,
  };
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
  };
}

async function authRoutes(fastify) {
  fastify.post('/auth/login', {
    config: {
      auth: false,
      rateLimit: {
        max: config.loginRateLimitMax,
        timeWindow: config.loginRateLimitWindow,
      },
    },
  }, async (request, reply) => {
    const body = request.body || {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const senha = typeof body.senha === 'string' ? body.senha : '';

    if (!email || !senha) {
      return reply.code(400).send({ error: 'Informe e-mail e senha.' });
    }

    const result = await query(
      `select id, email, senha_hash, nome, papel, ativo
       from usuarios
       where email = $1
       limit 1`,
      [email],
    );

    const usuario = result.rows[0];
    const senhaValida = usuario
      ? await argon2.verify(usuario.senha_hash, senha).catch(() => false)
      : false;

    if (!usuario || !usuario.ativo || !senhaValida) {
      return reply.code(401).send({ error: 'E-mail ou senha invalidos.' });
    }

    await query(
      'update usuarios set ultimo_login = now() where id = $1',
      [usuario.id],
    );

    const token = fastify.jwt.sign(
      {
        email: usuario.email,
        papel: usuario.papel,
      },
      {
        sub: usuario.id,
        expiresIn: config.sessionTtlSeconds,
      },
    );

    reply.setCookie(config.cookieName, token, {
      ...cookieOptions(),
      maxAge: config.sessionTtlSeconds,
    });

    return reply.send({ usuario: publicUser(usuario) });
  });

  fastify.post('/auth/logout', {
    config: {
      auth: false,
    },
  }, async (_request, reply) => {
    reply.clearCookie(config.cookieName, cookieOptions());
    return reply.send({ ok: true });
  });

  fastify.get('/auth/eu', {
    config: {
      roles: ['operador', 'gestor', 'admin'],
    },
  }, async (request) => {
    return { usuario: request.usuario };
  });
}

module.exports = authRoutes;
