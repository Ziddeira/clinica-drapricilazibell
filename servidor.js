'use strict';

/*
 * Servidor próprio do site (VPS, Render, Railway, Hostinger com Node…).
 * Na Vercel ele NÃO é usado: lá os arquivos de public/ saem pela CDN e a API
 * roda nas funções da pasta api/ (veja vercel.json).
 *
 * Sem dependências externas: precisa só do Node.js 18 ou mais novo.
 *
 *  - Serve os arquivos de public/ com cache, gzip e cabeçalhos de segurança.
 *  - POST  /api/agendamento  recebe o formulário, grava o lead e devolve o link do WhatsApp.
 *  - GET   /api/leads        lista os pedidos (exige ADMIN_TOKEN).
 *  - PATCH /api/leads/:id    muda o status de um pedido (exige ADMIN_TOKEN).
 *  - GET   /healthz          verificação de saúde para a hospedagem.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

carregarEnv(path.join(__dirname, '.env'));

const { rotaAgendamento, rotaLeads, enviarJson } = require('./lib/agendamento');
const { cabecalhos } = require('./lib/cabecalhos');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

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
  const cache = ext === '.woff2' ? 'public, max-age=31536000, immutable'
    : /^\.(png|jpe?g|webp|svg|ico)$/.test(ext) ? 'public, max-age=604800'
    : 'no-cache';

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
  try {
    const html = await fsp.readFile(path.join(PUBLIC_DIR, '404.html'));
    res.writeHead(404, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');
  }
}

/* ---------- Servidor ---------- */

const CABECALHOS = cabecalhos({ producao: process.env.NODE_ENV === 'production' });

const servidor = http.createServer(async (req, res) => {
  for (const [nome, valor] of Object.entries(CABECALHOS)) res.setHeader(nome, valor);
  const { pathname } = new URL(req.url, 'http://localhost');

  try {
    if (pathname === '/healthz') return enviarJson(res, 200, { ok: true });
    if (pathname === '/api/agendamento') return await rotaAgendamento(req, res);
    if (/^\/api\/leads(\/[^/]+)?$/.test(pathname)) return await rotaLeads(req, res);
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
    if (!process.env.ADMIN_TOKEN) console.log('Aviso: ADMIN_TOKEN não definido, o painel /admin fica desativado.');
  });
}

module.exports = { servidor };
