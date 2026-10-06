'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pz-leads-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_TOKEN = 'token-de-teste';
process.env.LEAD_WEBHOOK_URL = '';

const { servidor } = require('../server');
let base;

before(async () => {
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  servidor.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const pedido = (extra) => ({
  nome: 'Maria Teste',
  telefone: '(48) 99999-0000',
  servico: 'Clareamento dental',
  periodo: 'Manhã',
  mensagem: 'Quero clarear',
  consentimento: true,
  empresa: '',
  tempo: 15000,
  origem: { utm_source: 'google', utm_campaign: 'clareamento' },
  ...extra
});

const enviar = (corpo) => fetch(`${base}/api/agendamento`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(corpo)
});

test('serve a página inicial com cabeçalhos de segurança e gzip', async () => {
  const res = await fetch(`${base}/`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /sha256-/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await res.text(), /Pricila Zibell/);
});

test('bloqueia acesso fora da pasta public', async () => {
  const res = await fetch(`${base}/..%2Fserver.js`);
  assert.equal(res.status, 404);
});

test('rotas sem extensão abrem a página .html', async () => {
  const res = await fetch(`${base}/privacidade`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Política de Privacidade/);
});

test('grava o agendamento e devolve o link do WhatsApp', async () => {
  const res = await enviar(pedido());
  assert.equal(res.status, 201);
  const corpo = await res.json();
  assert.equal(corpo.ok, true);
  assert.match(corpo.whatsappUrl, /^https:\/\/wa\.me\/554832429297\?text=/);
  assert.match(decodeURIComponent(corpo.whatsappUrl), /Clareamento dental/);

  const linhas = fs.readFileSync(path.join(dataDir, 'leads.jsonl'), 'utf8').trim().split('\n');
  const lead = JSON.parse(linhas.at(-1));
  assert.equal(lead.telefone, '48999990000');
  assert.equal(lead.status, 'novo');
  assert.equal(lead.origem.utm_source, 'google');
});

test('recusa telefone inválido e falta de consentimento', async () => {
  let res = await enviar(pedido({ telefone: '1234' }));
  assert.equal(res.status, 400);
  res = await enviar(pedido({ consentimento: false }));
  assert.equal(res.status, 400);
});

test('robô recebe resposta normal mas não vira lead', async () => {
  const antes = fs.readFileSync(path.join(dataDir, 'leads.jsonl'), 'utf8');
  const res = await enviar(pedido({ empresa: 'spam', nome: 'Robo' }));
  assert.equal(res.status, 200);
  assert.equal(fs.readFileSync(path.join(dataDir, 'leads.jsonl'), 'utf8'), antes);
});

test('painel exige token e permite mudar status', async () => {
  let res = await fetch(`${base}/api/leads`);
  assert.equal(res.status, 401);

  const auth = { Authorization: 'Bearer token-de-teste', 'Content-Type': 'application/json' };
  res = await fetch(`${base}/api/leads`, { headers: auth });
  assert.equal(res.status, 200);
  const { leads } = await res.json();
  assert.equal(leads.length, 1);

  res = await fetch(`${base}/api/leads/${leads[0].id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'agendado' }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).lead.status, 'agendado');

  res = await fetch(`${base}/api/leads/${leads[0].id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'xyz' }) });
  assert.equal(res.status, 400);
});

test('limita envios repetidos do mesmo IP', async () => {
  let ultimo;
  for (let i = 0; i < 6; i++) ultimo = await enviar(pedido({ telefone: '1' }));
  assert.equal(ultimo.status, 429);
});
