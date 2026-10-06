'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');

// Imitação mínima da API REST do Upstash (/pipeline) com os comandos usados.
function redisFalso() {
  const kv = new Map();
  const listas = new Map();
  const exec = ([cmd, ...a]) => {
    switch (cmd) {
      case 'SET': kv.set(a[0], a[1]); return 'OK';
      case 'GET': return kv.has(a[0]) ? kv.get(a[0]) : null;
      case 'MGET': return a.map((k) => (kv.has(k) ? kv.get(k) : null));
      case 'LPUSH': { const l = listas.get(a[0]) || []; l.unshift(...a.slice(1)); listas.set(a[0], l); return l.length; }
      case 'LRANGE': return (listas.get(a[0]) || []).slice(Number(a[1]), Number(a[2]) + 1);
      case 'INCR': { const v = Number(kv.get(a[0]) || 0) + 1; kv.set(a[0], String(v)); return v; }
      case 'EXPIRE': return 1;
      default: return { erro: `comando ${cmd}` };
    }
  };
  return http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (p) => { corpo += p; });
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer segredo' || req.url !== '/pipeline') {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(JSON.parse(corpo).map((c) => ({ result: exec(c) }))));
    });
  });
}

function chamar(handler, { method = 'POST', url = '/api/agendamento', body, headers = {} }) {
  const req = Readable.from([]);
  Object.assign(req, { method, url, headers: { 'x-forwarded-for': '198.51.100.7', ...headers }, body, socket: {} });
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader() {},
      end: (dados) => resolve({ status: res.statusCode, json: dados ? JSON.parse(dados) : null })
    };
    handler(req, res);
  });
}

test('na Vercel com Upstash Redis, grava, lista e atualiza pedidos', async (t) => {
  const redis = redisFalso();
  await new Promise((r) => redis.listen(0, '127.0.0.1', r));
  const antes = { ...process.env };
  Object.assign(process.env, {
    VERCEL: '1',
    ADMIN_TOKEN: 'abc',
    KV_REST_API_URL: `http://127.0.0.1:${redis.address().port}`,
    KV_REST_API_TOKEN: 'segredo'
  });
  t.after(() => { process.env = antes; redis.close(); });

  const { rotaAgendamento, rotaLeads } = require('../lib/agendamento');
  const auth = { authorization: 'Bearer abc' };

  const criado = await chamar(rotaAgendamento, {
    body: { nome: 'Carla', telefone: '48977776666', servico: 'Tratamento de canal', consentimento: true, tempo: 8000 }
  });
  assert.equal(criado.status, 201);

  const lista = await chamar(rotaLeads, { method: 'GET', url: '/api/leads', headers: auth });
  assert.equal(lista.status, 200);
  assert.equal(lista.json.leads.length, 1);
  assert.equal(lista.json.leads[0].nome, 'Carla');

  // Na Vercel o rewrite entrega o id como ?id=
  const id = criado.json.id;
  const mudou = await chamar(rotaLeads, { method: 'PATCH', url: `/api/leads?id=${id}`, headers: auth, body: { status: 'agendado' } });
  assert.equal(mudou.status, 200);
  assert.equal(mudou.json.lead.status, 'agendado');

  let ultimo;
  for (let i = 0; i < 6; i++) ultimo = await chamar(rotaAgendamento, { body: { nome: 'x' } });
  assert.equal(ultimo.status, 429);
});
