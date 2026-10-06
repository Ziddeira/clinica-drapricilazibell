'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const { vercelJson } = require('../lib/cabecalhos');

const raiz = path.join(__dirname, '..');

test('vercel.json está em dia com os HTML (hash da CSP)', () => {
  const atual = JSON.parse(fs.readFileSync(path.join(raiz, 'vercel.json'), 'utf8'));
  assert.deepEqual(atual, vercelJson(), 'Rode `npm run vercel-json` e faça commit do resultado.');
});

test('nenhum arquivo ativa o preset "Node" da Vercel', () => {
  for (const nome of ['server.js', 'server.cjs', 'server.mjs', 'server.ts', 'src/server.js']) {
    assert.equal(fs.existsSync(path.join(raiz, nome)), false, `${nome} faria a Vercel tratar o site como servidor Node`);
  }
});

// Simula a requisição que a Vercel entrega às funções: corpo já em req.body.
function chamar(handler, { method = 'POST', url = '/api/agendamento', body, headers = {} }) {
  const req = Readable.from([]);
  Object.assign(req, { method, url, headers: { 'x-forwarded-for': '203.0.113.9', ...headers }, body, socket: {} });
  return new Promise((resolve) => {
    const cab = {};
    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader: (k, v) => { cab[k.toLowerCase()] = v; },
      end: (dados) => resolve({ status: res.statusCode, headers: cab, json: dados ? JSON.parse(dados) : null })
    };
    handler(req, res);
  });
}

test('funções da pasta api/ respondem no formato da Vercel', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pz-vercel-'));
  const antes = { ...process.env };
  Object.assign(process.env, { VERCEL: '1', DATA_DIR: dataDir, ADMIN_TOKEN: 'abc' });
  delete process.env.KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  t.after(() => {
    process.env = antes;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const agendamento = require('../api/agendamento');
  const leads = require('../api/leads');
  const saude = require('../api/saude');

  const ok = await chamar(agendamento, {
    body: { nome: 'João', telefone: '48988887777', servico: 'Limpeza e prevenção', periodo: 'Tarde', consentimento: true, tempo: 9000 }
  });
  assert.equal(ok.status, 201);
  assert.match(ok.json.whatsappUrl, /^https:\/\/wa\.me\/554832429297/);
  // Na Vercel sem Redis, nada é gravado em disco (o disco é somente leitura).
  assert.equal(fs.existsSync(path.join(dataDir, 'leads.jsonl')), false);

  const invalido = await chamar(agendamento, { body: 'não é json{' });
  assert.equal(invalido.status, 400);

  const painel = await chamar(leads, { method: 'GET', url: '/api/leads', headers: { authorization: 'Bearer abc' } });
  assert.equal(painel.status, 503);
  assert.match(painel.json.erro, /Upstash Redis/);

  assert.equal((await chamar(saude, { method: 'GET', url: '/healthz' })).status, 200);
});
