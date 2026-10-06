'use strict';

/*
 * Regras da API de agendamento, usadas tanto pelas funções da Vercel (api/)
 * quanto pelo servidor próprio (servidor.js).
 *
 * Onde os pedidos ficam guardados:
 *  - Upstash Redis, quando KV_REST_API_URL/KV_REST_API_TOKEN (integração da
 *    Vercel) ou UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN existem;
 *  - arquivo data/leads.jsonl, no servidor próprio;
 *  - em nenhum lugar, na Vercel sem Redis: o pedido segue só para o WhatsApp
 *    e para o webhook, se houver.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVICOS = [
  'Avaliação / check-up', 'Limpeza e prevenção', 'Clareamento dental', 'Restaurações',
  'Estética do sorriso / facetas', 'Tratamento de canal', 'Próteses e coroas',
  'Extração / cirurgia', 'Estou com dor', 'Outro assunto'
];
const PERIODOS = ['Qualquer horário', 'Manhã', 'Tarde'];
const STATUS = ['novo', 'contatado', 'agendado', 'perdido'];

const JANELA_S = 10 * 60;
const MAX_ENVIOS = 5;

function config() {
  const env = process.env;
  return {
    adminToken: env.ADMIN_TOKEN || '',
    whatsapp: (env.WHATSAPP_NUMBER || '554832429297').replace(/\D/g, ''),
    webhook: env.LEAD_WEBHOOK_URL || '',
    dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),
    redisUrl: (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, ''),
    redisToken: env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '',
    naVercel: Boolean(env.VERCEL),
    confiarProxy: Boolean(env.VERCEL) || env.TRUST_PROXY === '1'
  };
}

/* ---------- HTTP ---------- */

function enviarJson(res, status, corpo) {
  const dados = JSON.stringify(corpo);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(dados));
  res.end(dados);
}

// Na Vercel o corpo já vem em req.body; no servidor próprio, lemos o fluxo.
async function lerJson(req, limite = 16 * 1024) {
  if (req.body !== undefined) {
    const b = req.body;
    if (Buffer.isBuffer(b)) return JSON.parse(b.toString('utf8'));
    if (typeof b === 'string') return JSON.parse(b);
    return b;
  }
  const partes = [];
  let tamanho = 0;
  for await (const parte of req) {
    tamanho += parte.length;
    if (tamanho > limite) throw Object.assign(new Error('Corpo grande demais'), { status: 413 });
    partes.push(parte);
  }
  return JSON.parse(Buffer.concat(partes).toString('utf8'));
}

function ipDe(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (config().confiarProxy && fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

function tokenValido(req) {
  const { adminToken } = config();
  if (!adminToken) return false;
  const enviado = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(enviado).digest();
  const b = crypto.createHash('sha256').update(adminToken).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ---------- Armazenamento ---------- */

async function redis(comandos) {
  const { redisUrl, redisToken } = config();
  const res = await fetch(`${redisUrl}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(comandos),
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error(`Redis respondeu ${res.status}`);
  const respostas = await res.json();
  return respostas.map((r) => {
    if (r.error) throw new Error(`Redis: ${r.error}`);
    return r.result;
  });
}

let filaArquivo = Promise.resolve();
function emFila(tarefa) {
  const proxima = filaArquivo.then(tarefa, tarefa);
  filaArquivo = proxima.catch(() => {});
  return proxima;
}

function arquivoLeads() {
  return path.join(config().dataDir, 'leads.jsonl');
}

async function lerArquivo() {
  let texto;
  try { texto = await fsp.readFile(arquivoLeads(), 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return texto.split('\n').filter(Boolean).flatMap((linha) => {
    try { return [JSON.parse(linha)]; } catch { return []; }
  });
}

function armazenamento() {
  const c = config();
  if (c.redisUrl && c.redisToken) return 'redis';
  if (c.naVercel) return null;
  return 'arquivo';
}

async function salvarLead(lead) {
  const tipo = armazenamento();
  if (tipo === 'redis') {
    await redis([['SET', `pz:lead:${lead.id}`, JSON.stringify(lead)], ['LPUSH', 'pz:leads', lead.id]]);
  } else if (tipo === 'arquivo') {
    await emFila(async () => {
      await fsp.mkdir(config().dataDir, { recursive: true });
      await fsp.appendFile(arquivoLeads(), JSON.stringify(lead) + '\n', { mode: 0o600 });
    });
  }
  return tipo;
}

async function listarLeads() {
  let leads;
  if (armazenamento() === 'redis') {
    const [ids] = await redis([['LRANGE', 'pz:leads', '0', '1999']]);
    if (!ids.length) return [];
    const [valores] = await redis([['MGET', ...ids.map((id) => `pz:lead:${id}`)]]);
    leads = valores.filter(Boolean).map((v) => JSON.parse(v));
  } else {
    leads = await lerArquivo();
  }
  return leads.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

async function atualizarStatus(id, status) {
  const agora = new Date().toISOString();
  if (armazenamento() === 'redis') {
    const [valor] = await redis([['GET', `pz:lead:${id}`]]);
    if (!valor) return null;
    const lead = { ...JSON.parse(valor), status, atualizadoEm: agora };
    await redis([['SET', `pz:lead:${id}`, JSON.stringify(lead)]]);
    return lead;
  }
  return emFila(async () => {
    const leads = await lerArquivo();
    const lead = leads.find((l) => l.id === id);
    if (!lead) return null;
    lead.status = status;
    lead.atualizadoEm = agora;
    const temp = arquivoLeads() + '.tmp';
    await fsp.writeFile(temp, leads.map((l) => JSON.stringify(l)).join('\n') + '\n', { mode: 0o600 });
    await fsp.rename(temp, arquivoLeads());
    return lead;
  });
}

/* ---------- Limite de envios por IP ---------- */

const enviosMemoria = new Map();

async function excedeuLimite(ip) {
  if (armazenamento() === 'redis') {
    const chave = `pz:limite:${crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24)}`;
    try {
      const [total] = await redis([['INCR', chave], ['EXPIRE', chave, String(JANELA_S), 'NX']]);
      return total > MAX_ENVIOS;
    } catch {
      // Sem Redis no momento: cai no limite em memória.
    }
  }
  const agora = Date.now();
  const lista = (enviosMemoria.get(ip) || []).filter((t) => agora - t < JANELA_S * 1000);
  lista.push(agora);
  enviosMemoria.set(ip, lista);
  if (enviosMemoria.size > 5000) enviosMemoria.clear();
  return lista.length > MAX_ENVIOS;
}

/* ---------- Regras do pedido ---------- */

const texto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function validarAgendamento(d) {
  if (!d || typeof d !== 'object') return { erro: 'Dados inválidos.' };
  const nome = texto(d.nome, 80);
  const telefone = String(d.telefone || '').replace(/\D/g, '');
  const servico = SERVICOS.includes(d.servico) ? d.servico : 'Avaliação / check-up';
  const periodo = PERIODOS.includes(d.periodo) ? d.periodo : 'Qualquer horário';
  const mensagem = String(d.mensagem == null ? '' : d.mensagem).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 600);

  if (nome.length < 2) return { erro: 'Informe seu nome.' };
  if (!/^[1-9]{2}9?\d{8}$/.test(telefone)) return { erro: 'Informe um WhatsApp válido com DDD.' };
  if (d.consentimento !== true) return { erro: 'É preciso autorizar o contato para agendar.' };

  const origem = {};
  if (d.origem && typeof d.origem === 'object') {
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'referrer']) {
      if (d.origem[k]) origem[k] = texto(d.origem[k], 200);
    }
  }
  return { lead: { nome, telefone, servico, periodo, mensagem, origem, pagina: texto(d.pagina, 120) } };
}

function linkWhatsApp(l) {
  const linhas = [
    'Olá, Dra. Pricila! Vim pelo site e gostaria de agendar um horário.',
    '',
    `*Nome:* ${l.nome}`,
    `*Interesse:* ${l.servico}`,
    `*Melhor período:* ${l.periodo}`
  ];
  if (l.mensagem) linhas.push(`*Mensagem:* ${l.mensagem}`);
  return `https://wa.me/${config().whatsapp}?text=${encodeURIComponent(linhas.join('\n'))}`;
}

async function avisarWebhook(lead) {
  const { webhook } = config();
  if (!webhook) return;
  const telefone = lead.telefone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
  const resumo = `Novo pedido de agendamento: ${lead.nome} · ${telefone} · ${lead.servico} · ${lead.periodo}`;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // "text" e "content" cobrem Slack, Google Chat e Discord; o lead completo serve para Make/Zapier.
      body: JSON.stringify({ text: resumo, content: resumo, lead }),
      signal: AbortSignal.timeout(4000)
    });
  } catch (e) {
    console.error('[webhook] falhou:', e.message);
  }
}

/* ---------- Rotas ---------- */

async function rotaAgendamento(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return enviarJson(res, 405, { ok: false, erro: 'Método não permitido.' });
  }
  if (await excedeuLimite(ipDe(req))) {
    return enviarJson(res, 429, { ok: false, erro: 'Muitas tentativas. Chame direto no WhatsApp, por favor.' });
  }
  let dados;
  try {
    dados = await lerJson(req);
  } catch (e) {
    return enviarJson(res, e.status || 400, { ok: false, erro: 'Dados inválidos.' });
  }

  // Robôs costumam preencher o campo escondido ou enviar em menos de 2 segundos.
  const pareceRobo = Boolean(dados && (dados.empresa || (typeof dados.tempo === 'number' && dados.tempo < 2000)));

  const { erro, lead } = validarAgendamento(dados);
  if (erro) return enviarJson(res, 400, { ok: false, erro });

  const whatsappUrl = linkWhatsApp(lead);
  if (pareceRobo) return enviarJson(res, 200, { ok: true, whatsappUrl });

  const registro = { id: crypto.randomUUID(), criadoEm: new Date().toISOString(), status: 'novo', ...lead };
  try {
    await salvarLead(registro);
  } catch (e) {
    console.error('[leads] não foi possível gravar:', e.message);
  }
  // Em função serverless, o que roda depois da resposta pode ser cortado: avisamos antes.
  await avisarWebhook(registro);
  console.log(`[lead] ${registro.criadoEm} ${registro.servico}`);
  enviarJson(res, 201, { ok: true, id: registro.id, whatsappUrl });
}

async function rotaLeads(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const caminho = url.pathname.match(/^\/api\/leads\/([0-9a-f-]{36})$/);
  const id = (caminho && caminho[1]) || url.searchParams.get('id') || '';

  if (!config().adminToken) return enviarJson(res, 503, { ok: false, erro: 'Defina ADMIN_TOKEN no servidor para usar o painel.' });
  if (!tokenValido(req)) return enviarJson(res, 401, { ok: false, erro: 'Token inválido.' });
  if (!armazenamento()) {
    return enviarJson(res, 503, { ok: false, erro: 'Os pedidos não estão sendo guardados. Conecte um banco Upstash Redis em Vercel → Storage.' });
  }
  if (id && !/^[0-9a-f-]{36}$/.test(id)) return enviarJson(res, 404, { ok: false, erro: 'Pedido não encontrado.' });

  if (req.method === 'GET' && !id) {
    return enviarJson(res, 200, { ok: true, leads: await listarLeads() });
  }
  if (req.method === 'PATCH' && id) {
    let dados;
    try { dados = await lerJson(req, 1024); } catch { return enviarJson(res, 400, { ok: false, erro: 'Dados inválidos.' }); }
    if (!dados || !STATUS.includes(dados.status)) return enviarJson(res, 400, { ok: false, erro: 'Status inválido.' });
    const lead = await atualizarStatus(id, dados.status);
    if (!lead) return enviarJson(res, 404, { ok: false, erro: 'Pedido não encontrado.' });
    return enviarJson(res, 200, { ok: true, lead });
  }
  res.setHeader('Allow', id ? 'PATCH' : 'GET');
  enviarJson(res, 405, { ok: false, erro: 'Método não permitido.' });
}

// Envolve a rota para nunca derrubar a função com erro não tratado.
function seguro(rota) {
  return async (req, res) => {
    try {
      await rota(req, res);
    } catch (e) {
      console.error('[api]', e);
      if (!res.headersSent) enviarJson(res, 500, { ok: false, erro: 'Erro interno.' });
      else res.end();
    }
  };
}

module.exports = {
  rotaAgendamento: seguro(rotaAgendamento),
  rotaLeads: seguro(rotaLeads),
  validarAgendamento,
  enviarJson
};
