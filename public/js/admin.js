(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var CHAVE = 'pz_admin_token';
  var token = '';
  var leads = [];
  var filtro = '';

  try { token = sessionStorage.getItem(CHAVE) || ''; } catch (e) { /* sem armazenamento */ }

  function api(caminho, opcoes) {
    opcoes = opcoes || {};
    opcoes.headers = Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, opcoes.headers || {});
    return fetch(caminho, opcoes).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (corpo) {
        if (!res.ok) throw Object.assign(new Error(corpo.erro || 'Erro ' + res.status), { status: res.status });
        return corpo;
      });
    });
  }

  function formatarTelefone(t) {
    return t.length === 11 ? '(' + t.slice(0, 2) + ') ' + t.slice(2, 7) + '-' + t.slice(7)
      : '(' + t.slice(0, 2) + ') ' + t.slice(2, 6) + '-' + t.slice(6);
  }

  function formatarData(iso) {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function dominio(url) {
    try { return new URL(url).hostname; } catch (e) { return url; }
  }

  function celula(tr, conteudo, classe) {
    var td = document.createElement('td');
    if (classe) td.className = classe;
    if (typeof conteudo === 'string') td.textContent = conteudo;
    else conteudo.forEach(function (n) { td.appendChild(n); });
    tr.appendChild(td);
  }

  function el(tag, texto, attrs) {
    var n = document.createElement(tag);
    if (texto) n.textContent = texto;
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function desenhar() {
    var corpo = $('[data-tabela]');
    corpo.textContent = '';
    var visiveis = leads.filter(function (l) { return !filtro || l.status === filtro; });

    visiveis.forEach(function (l) {
      var tr = document.createElement('tr');
      celula(tr, formatarData(l.criadoEm));

      var primeiroNome = l.nome.split(' ')[0];
      var wa = el('a', 'WhatsApp ' + formatarTelefone(l.telefone), {
        class: 'wa-link', target: '_blank', rel: 'noopener',
        href: 'https://wa.me/55' + l.telefone + '?text=' + encodeURIComponent('Olá, ' + primeiroNome + '! Aqui é do consultório da Dra. Pricila Zibell. Recebemos seu pedido de agendamento pelo site.')
      });
      celula(tr, [el('strong', l.nome), wa]);
      celula(tr, [el('strong', l.servico), el('small', l.periodo)]);
      celula(tr, l.mensagem || '—', 'msg');

      var o = l.origem || {};
      var origem = o.utm_source ? o.utm_source + (o.utm_campaign ? ' / ' + o.utm_campaign : '') : (o.gclid ? 'Google Ads' : (o.referrer ? dominio(o.referrer) : 'Direto'));
      celula(tr, origem);

      var sel = el('select', '', { 'aria-label': 'Status de ' + l.nome, 'data-status': l.status });
      ['novo', 'contatado', 'agendado', 'perdido'].forEach(function (s) {
        var op = el('option', s.charAt(0).toUpperCase() + s.slice(1), { value: s });
        if (s === l.status) op.selected = true;
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () {
        var anterior = l.status;
        sel.disabled = true;
        api('/api/leads/' + l.id, { method: 'PATCH', body: JSON.stringify({ status: sel.value }) })
          .then(function (r) { l.status = r.lead.status; })
          .catch(function (e) { alert(e.message); l.status = anterior; })
          .then(function () { desenhar(); });
      });
      celula(tr, [sel]);
      corpo.appendChild(tr);
    });

    $('[data-vazio]').hidden = visiveis.length > 0;

    var conta = { novo: 0, contatado: 0, agendado: 0, perdido: 0 };
    leads.forEach(function (l) { conta[l.status] = (conta[l.status] || 0) + 1; });
    var taxa = leads.length ? Math.round((conta.agendado / leads.length) * 100) : 0;
    var stats = $('[data-stats]');
    stats.textContent = '';
    [[leads.length, 'Pedidos'], [conta.novo, 'Aguardando contato'], [conta.agendado, 'Agendados'], [taxa + '%', 'Conversão']].forEach(function (s) {
      var d = el('div', '', { class: 'stat' });
      d.appendChild(el('strong', String(s[0])));
      d.appendChild(el('span', s[1]));
      stats.appendChild(d);
    });
    $('[data-resumo]').textContent = leads.length ? 'Último pedido em ' + formatarData(leads[0].criadoEm) : '';
  }

  function carregar() {
    return api('/api/leads').then(function (r) {
      leads = r.leads;
      $('[data-login]').hidden = true;
      $('[data-painel]').hidden = false;
      $('[data-sair]').hidden = false;
      desenhar();
    });
  }

  function csv() {
    var cab = ['Recebido', 'Nome', 'Telefone', 'Interesse', 'Período', 'Mensagem', 'Status', 'utm_source', 'utm_campaign', 'gclid'];
    var esc = function (v) {
      var s = String(v == null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmulas ao abrir no Excel
      return '"' + s.replace(/"/g, '""') + '"';
    };
    var linhas = leads.map(function (l) {
      var o = l.origem || {};
      return [formatarData(l.criadoEm), l.nome, formatarTelefone(l.telefone), l.servico, l.periodo, l.mensagem, l.status, o.utm_source, o.utm_campaign, o.gclid].map(esc).join(';');
    });
    var blob = new Blob(['﻿' + [cab.join(';')].concat(linhas).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = el('a', '', { href: URL.createObjectURL(blob), download: 'agendamentos-' + new Date().toISOString().slice(0, 10) + '.csv' });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  $('[data-login]').addEventListener('submit', function (ev) {
    ev.preventDefault();
    token = ev.target.token.value.trim();
    var erro = $('[data-login-erro]');
    erro.hidden = true;
    carregar().then(function () {
      try { sessionStorage.setItem(CHAVE, token); } catch (e) { /* ok */ }
    }).catch(function (e) {
      erro.textContent = e.message;
      erro.hidden = false;
    });
  });

  $('[data-sair]').addEventListener('click', function () {
    try { sessionStorage.removeItem(CHAVE); } catch (e) { /* ok */ }
    location.reload();
  });
  $('[data-atualizar]').addEventListener('click', function () { carregar().catch(function (e) { alert(e.message); }); });
  $('[data-csv]').addEventListener('click', csv);
  $('[data-filtros]').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-filtro]');
    if (!b) return;
    filtro = b.dataset.filtro;
    document.querySelectorAll('[data-filtro]').forEach(function (x) { x.classList.toggle('is-active', x === b); });
    desenhar();
  });

  if (token) carregar().catch(function () { token = ''; });
})();
