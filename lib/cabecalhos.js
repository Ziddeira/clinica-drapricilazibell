'use strict';

/*
 * Cabeçalhos de segurança do site, iguais no servidor próprio e na Vercel.
 * A CSP libera só os <script> inline que existem nos HTML (por hash).
 *
 * Mudou algum <script> inline? Rode `npm run vercel-json` para atualizar o
 * vercel.json; o teste falha se ele ficar desatualizado.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const RAIZ = path.join(__dirname, '..');

function hashesInline() {
  const hashes = new Set();
  for (const nome of fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html')).sort()) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, nome), 'utf8');
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      hashes.add(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
    }
  }
  return [...hashes].join(' ');
}

function cabecalhos({ producao = true } = {}) {
  const csp = [
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

  const cab = {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
  };
  if (producao) cab['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return cab;
}

// Configuração completa da Vercel: site estático em public/ + funções em api/.
function vercelJson() {
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: null,
    installCommand: '',
    buildCommand: '',
    outputDirectory: 'public',
    cleanUrls: true,
    rewrites: [
      { source: '/api/leads/:id', destination: '/api/leads?id=:id' },
      { source: '/healthz', destination: '/api/saude' }
    ],
    headers: [
      {
        source: '/(.*)',
        headers: Object.entries(cabecalhos({ producao: true })).map(([key, value]) => ({ key, value }))
      },
      {
        source: '/fonts/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
      },
      {
        source: '/img/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }]
      }
    ]
  };
}

if (require.main === module) {
  fs.writeFileSync(path.join(RAIZ, 'vercel.json'), JSON.stringify(vercelJson(), null, 2) + '\n');
  console.log('vercel.json atualizado.');
}

module.exports = { cabecalhos, vercelJson };
