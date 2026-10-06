'use strict';

// Função da Vercel: GET /healthz (via rewrite no vercel.json)
const { enviarJson } = require('../lib/agendamento');

module.exports = (req, res) => enviarJson(res, 200, { ok: true });
