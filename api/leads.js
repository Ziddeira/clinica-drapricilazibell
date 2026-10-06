'use strict';

// Função da Vercel: GET /api/leads e PATCH /api/leads/:id (via rewrite no vercel.json)
module.exports = require('../lib/agendamento').rotaLeads;
