'use strict';

/*
 * Servidor do site da Dra. Pricila Zibell.
 * Sem dependências externas: precisa só do Node.js 18 ou mais novo.
 *
 *  - Serve os arquivos de public/ com cache, gzip e cabeçalhos de segurança.
 *  - POST /api/agendamento  recebe o formulário, grava o lead e devolve o link do WhatsApp.
 *  - GET  /api/leads        lista os pedidos (exige ADMIN_TOKEN).
 *  - PATCH /api/leads/:id   muda o status de um pedido (exige ADMIN_TOKEN).
 *  - GET  /healthz          verificação de saúde para a hospedagem.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

carregarEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.jsonl');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const WHATSAPP = (process.env.WHATSAPP_NUMBER || '554832429297').replace(/\D/g, '');
const WEBHOOK_URL = process.env.LEAD_WEBHOOK_URL || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const SERVICOS = [
  'Avaliação / check-up', 'Limpeza e prevenção', 'Clareamento dental', 'Restaurações',
  'Estética do sorriso / facetas', 'Tratamento de canal', 'Próteses e coroas',
  'Extração / cirurgia', 'Estou com dor', 'Outro assunto'
];
const PERIODOS = ['Qualquer horário', 'Manhã', 'Tarde'];
const STATUS = ['novo', 'contatado', 'agendado', 'perdido'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};
const COMPRIMIR = /^(text\/|application\/(json|xml|manifest)|image\/svg)/;

/* ---------- Utilidades ---------- */

function carregarEnv(arquivo) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch { return; }
  for (const linha of texto.split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || linha.trim().startsWith('#')) continue;
    const valor = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
  }
}

// Hashes dos <script> inline do HTML, para a CSP liberar só esses trechos.
function hashesInline() {
  const hashes = new Set();
  for (const nome of fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, nome), 'utf8');
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      hashes.add(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
    }
  }
  return [...hashes].join(' ');
}

const CSP = [
  "default-src 'self'",
  `script-src 'self' ${hashesInline()} https://www.googletagmanager.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com",
  "font-src 'self'",
  "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
  'frame-src https://www.google.com https://maps.google.com',
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'"
].join('; ');

function cabecalhosSeguranca(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function enviarJson(res, status, corpo) {
  const dados = JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(dados),
    'Cache-Control': 'no-store'
  });
  res.end(dados);
}

function ipDe(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) {
    return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

function lerCorpo(req, limite = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (parte) => {
      tamanho += parte.length;
      if (tamanho > limite) {
        reject(Object.assign(new Error('Corpo grande demais'), { status: 413 }));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

function tokenValido(req) {
  if (!ADMIN_TOKEN) return false;
  const enviado = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(enviado).digest();
  const b = crypto.createHash('sha256').update(ADMIN_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ---------- Limite de envios por IP ---------- */

const JANELA_MS = 10 * 60 * 1000;
const MAX_ENVIOS = 5;
const envios = new Map();

function excedeuLimite(ip) {
  const agora = Date.now();
  const lista = (envios.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  lista.push(agora);
  envios.set(ip, lista);
  return lista.length > MAX_ENVIOS;
}

setInterval(() => {
  const agora = Date.now();
  for (const [ip, lista] of envios) {
    if (lista.every((t) => agora - t >= JANELA_MS)) envios.delete(ip);
  }
}, JANELA_MS).unref();

/* ---------- Leads ---------- */

let filaEscrita = Promise.resolve();
function emFila(tarefa) {
  const proxima = filaEscrita.then(tarefa, tarefa);
  filaEscrita = proxima.catch(() => {});
  return proxima;
}

async function lerLeads() {
  let texto;
  try { texto = await fsp.readFile(LEADS_FILE, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return texto.split('\n').filter(Boolean).flatMap((linha) => {
    try { return [JSON.parse(linha)]; } catch { return []; }
  });
}

function salvarLead(lead) {
  return emFila(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.appendFile(LEADS_FILE, JSON.stringify(lead) + '\n', { mode: 0o600 });
  });
}

function atualizarStatus(id, status) {
  return emFila(async () => {
    const leads = await lerLeads();
    const lead = leads.find((l) => l.id === id);
    if (!lead) return null;
    lead.status = status;
    lead.atualizadoEm = new Date().toISOString();
    const temp = LEADS_FILE + '.tmp';
    await fsp.writeFile(temp, leads.map((l) => JSON.stringify(l)).join('\n') + '\n', { mode: 0o600 });
    await fsp.rename(temp, LEADS_FILE);
    return lead;
  });
}

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

function mensagemWhatsApp(l) {
  const linhas = [
    'Olá, Dra. Pricila! Vim pelo site e gostaria de agendar um horário.',
    '',
    `*Nome:* ${l.nome}`,
    `*Interesse:* ${l.servico}`,
    `*Melhor período:* ${l.periodo}`
  ];
  if (l.mensagem) linhas.push(`*Mensagem:* ${l.mensagem}`);
  return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(linhas.join('\n'))}`;
}

async function avisarWebhook(lead) {
  if (!WEBHOOK_URL) return;
  const telefone = lead.telefone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
  const resumo = `Novo pedido de agendamento: ${lead.nome} · ${telefone} · ${lead.servico} · ${lead.periodo}`;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // "text" e "content" cobrem Slack, Google Chat e Discord; o lead completo serve para Make/Zapier.
      body: JSON.stringify({ text: resumo, content: resumo, lead }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    console.error('[webhook] falhou:', e.message);
  }
}

/* ---------- Rotas da API ---------- */

async function apiAgendamento(req, res) {
  if (excedeuLimite(ipDe(req))) {
    return enviarJson(res, 429, { ok: false, erro: 'Muitas tentativas. Chame direto no WhatsApp, por favor.' });
  }
  let dados;
  try {
    dados = JSON.parse(await lerCorpo(req));
  } catch (e) {
    return enviarJson(res, e.status || 400, { ok: false, erro: 'Dados inválidos.' });
  }

  // Robôs costumam preencher o campo escondido ou enviar em menos de 2 segundos.
  const pareceRobo = Boolean(dados && (dados.empresa || (typeof dados.tempo === 'number' && dados.tempo < 2000)));

  const { erro, lead } = validarAgendamento(dados);
  if (erro) return enviarJson(res, 400, { ok: false, erro });

  const whatsappUrl = mensagemWhatsApp(lead);
  if (pareceRobo) return enviarJson(res, 200, { ok: true, whatsappUrl });

  const registro = {
    id: crypto.randomUUID(),
    criadoEm: new Date().toISOString(),
    status: 'novo',
    ...lead
  };
  try {
    await salvarLead(registro);
  } catch (e) {
    console.error('[leads] não foi possível gravar:', e.message);
  }
  avisarWebhook(registro);
  console.log(`[lead] ${registro.criadoEm} ${registro.servico}`);
  enviarJson(res, 201, { ok: true, id: registro.id, whatsappUrl });
}

async function apiLeads(req, res, id) {
  if (!ADMIN_TOKEN) return enviarJson(res, 503, { ok: false, erro: 'Defina ADMIN_TOKEN no servidor para usar o painel.' });
  if (!tokenValido(req)) return enviarJson(res, 401, { ok: false, erro: 'Token inválido.' });

  if (req.method === 'GET' && !id) {
    const leads = await lerLeads();
    leads.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    return enviarJson(res, 200, { ok: true, leads });
  }
  if (req.method === 'PATCH' && id) {
    let dados;
    try { dados = JSON.parse(await lerCorpo(req, 1024)); } catch { return enviarJson(res, 400, { ok: false, erro: 'Dados inválidos.' }); }
    if (!STATUS.includes(dados.status)) return enviarJson(res, 400, { ok: false, erro: 'Status inválido.' });
    const lead = await atualizarStatus(id, dados.status);
    if (!lead) return enviarJson(res, 404, { ok: false, erro: 'Pedido não encontrado.' });
    return enviarJson(res, 200, { ok: true, lead });
  }
  res.setHeader('Allow', id ? 'PATCH' : 'GET');
  enviarJson(res, 405, { ok: false, erro: 'Método não permitido.' });
}

/* ---------- Arquivos estáticos ---------- */

const cacheArquivos = new Map();

async function servirArquivo(req, res, pathname) {
  let relativo;
  try { relativo = decodeURIComponent(pathname); } catch { relativo = '/'; }
  if (relativo.endsWith('/')) relativo += 'index.html';
  if (!path.extname(relativo)) relativo += '.html'; // /privacidade -> privacidade.html

  const arquivo = path.normalize(path.join(PUBLIC_DIR, relativo));
  if (!arquivo.startsWith(PUBLIC_DIR + path.sep)) return naoEncontrado(req, res);

  let info;
  try {
    const stat = await fsp.stat(arquivo);
    if (!stat.isFile()) return naoEncontrado(req, res);
    const chave = `${arquivo}:${stat.mtimeMs}`;
    info = cacheArquivos.get(chave);
    if (!info) {
      const conteudo = await fsp.readFile(arquivo);
      const tipo = MIME[path.extname(arquivo).toLowerCase()] || 'application/octet-stream';
      info = {
        conteudo,
        tipo,
        gzip: COMPRIMIR.test(tipo) && conteudo.length > 1024 ? zlib.gzipSync(conteudo, { level: 9 }) : null,
        etag: `"${crypto.createHash('sha1').update(conteudo).digest('base64url').slice(0, 20)}"`
      };
      cacheArquivos.set(chave, info);
    }
  } catch {
    return naoEncontrado(req, res);
  }

  const ext = path.extname(arquivo);
  const cache = ext === '.html' ? 'no-cache'
    : ext === '.woff2' ? 'public, max-age=31536000, immutable'
    : 'public, max-age=604800';

  const cab = { 'Content-Type': info.tipo, 'Cache-Control': cache, ETag: info.etag, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === info.etag) {
    res.writeHead(304, cab);
    return res.end();
  }
  const usarGzip = info.gzip && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const corpo = usarGzip ? info.gzip : info.conteudo;
  if (usarGzip) cab['Content-Encoding'] = 'gzip';
  cab['Content-Length'] = corpo.length;
  res.writeHead(200, cab);
  res.end(req.method === 'HEAD' ? undefined : corpo);
}

async function naoEncontrado(req, res) {
  const pagina = path.join(PUBLIC_DIR, '404.html');
  try {
    const html = await fsp.readFile(pagina);
    res.writeHead(404, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');
  }
}

/* ---------- Servidor ---------- */

const servidor = http.createServer(async (req, res) => {
  cabecalhosSeguranca(res);
  const { pathname } = new URL(req.url, 'http://localhost');

  try {
    if (pathname === '/healthz') return enviarJson(res, 200, { ok: true });

    if (pathname === '/api/agendamento') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return enviarJson(res, 405, { ok: false, erro: 'Método não permitido.' });
      }
      return await apiAgendamento(req, res);
    }

    const rotaLeads = pathname.match(/^\/api\/leads(?:\/([0-9a-f-]{36}))?$/);
    if (rotaLeads) return await apiLeads(req, res, rotaLeads[1]);

    if (pathname.startsWith('/api/')) return enviarJson(res, 404, { ok: false, erro: 'Rota não encontrada.' });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return enviarJson(res, 405, { ok: false, erro: 'Método não permitido.' });
    }
    return await servirArquivo(req, res, pathname);
  } catch (e) {
    console.error('[erro]', e);
    if (!res.headersSent) enviarJson(res, 500, { ok: false, erro: 'Erro interno.' });
    else res.end();
  }
});

if (require.main === module) {
  servidor.listen(PORT, HOST, () => {
    console.log(`Site da Dra. Pricila Zibell em http://localhost:${PORT}`);
    if (!ADMIN_TOKEN) console.log('Aviso: ADMIN_TOKEN não definido, o painel /admin fica desativado.');
  });
}

module.exports = { servidor, validarAgendamento };
