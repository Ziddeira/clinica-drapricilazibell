(function () {
  'use strict';

  var cfg = window.SITE_CONFIG || {};
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- Origem do visitante (UTM) para medir campanhas ---------- */
  var origem = (function () {
    var key = 'pz_origem';
    var params = new URLSearchParams(location.search);
    var atual = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach(function (k) {
      if (params.get(k)) atual[k] = params.get(k).slice(0, 120);
    });
    try {
      if (Object.keys(atual).length) {
        atual.referrer = document.referrer.slice(0, 200);
        sessionStorage.setItem(key, JSON.stringify(atual));
        return atual;
      }
      var salvo = sessionStorage.getItem(key);
      if (salvo) return JSON.parse(salvo);
    } catch (e) { /* armazenamento indisponível */ }
    return document.referrer ? { referrer: document.referrer.slice(0, 200) } : {};
  })();

  /* ---------- Rastreamento de conversões ---------- */
  window.dataLayer = window.dataLayer || [];
  function track(evento, dados) {
    var payload = Object.assign({ event: evento }, dados || {});
    window.dataLayer.push(payload);
    if (typeof window.gtag === 'function') window.gtag('event', evento, dados || {});
  }

  function carregarTags() {
    if (cfg.googleTagManager) {
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(cfg.googleTagManager);
      document.head.appendChild(s);
    } else if (cfg.googleAnalytics) {
      var g = document.createElement('script');
      g.async = true;
      g.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.googleAnalytics);
      document.head.appendChild(g);
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', cfg.googleAnalytics);
    }
  }

  /* ---------- Links de contato ---------- */
  function waLink(mensagem) {
    return 'https://wa.me/' + cfg.whatsapp + '?text=' + encodeURIComponent(mensagem || cfg.mensagemPadrao);
  }

  function mensagemDoLink(el) {
    if (el.dataset.msg) return el.dataset.msg;
    if (el.dataset.servico) {
      return 'Olá, Dra. Pricila! Vim pelo site e tenho interesse em ' + el.dataset.servico + '. Quais os horários disponíveis?';
    }
    return cfg.mensagemPadrao;
  }

  function prepararLinks() {
    var destino = encodeURIComponent(cfg.endereco || '');

    $$('[data-wa]').forEach(function (el) {
      el.href = waLink(mensagemDoLink(el));
      el.target = '_blank';
      el.rel = 'noopener';
    });
    if (cfg.telefone) {
      $$('[data-tel]').forEach(function (el) { el.href = 'tel:' + cfg.telefone.link; });
      $$('[data-phone-text]').forEach(function (el) { el.textContent = cfg.telefone.exibicao; });
    }
    $$('[data-directions]').forEach(function (el) {
      el.href = 'https://www.google.com/maps/dir/?api=1&destination=' + destino;
    });
    $$('[data-waze]').forEach(function (el) {
      el.href = 'https://waze.com/ul?q=' + destino + '&navigate=yes';
    });
    if (cfg.perfilGoogle) $$('[data-google]').forEach(function (el) { el.href = cfg.perfilGoogle; });
    if (cfg.horarioTexto) $$('[data-hours-text]').forEach(function (el) { el.textContent = cfg.horarioTexto; });
    if (cfg.cro) $$('[data-cro-inline]').forEach(function (el) { el.textContent = ' · ' + cfg.cro; });
    if (cfg.totalAvaliacoes) {
      $$('[data-reviews-count]').forEach(function (el) {
        el.textContent = cfg.totalAvaliacoes + (cfg.totalAvaliacoes === 1 ? ' avaliação' : ' avaliações');
      });
    }
    $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

    // Um único ouvinte registra todos os cliques de contato.
    document.addEventListener('click', function (ev) {
      var el = ev.target.closest('a[data-wa], a[data-tel], a[data-directions], a[data-waze], a[data-google]');
      if (!el) return;
      var tipo = el.hasAttribute('data-wa') ? 'whatsapp'
        : el.hasAttribute('data-tel') ? 'telefone'
        : el.hasAttribute('data-google') ? 'perfil_google' : 'rotas';
      track(tipo === 'whatsapp' || tipo === 'telefone' ? 'generate_lead' : 'contact_intent', {
        canal: tipo,
        posicao: el.dataset.cta || 'desconhecida',
        servico: el.dataset.servico || ''
      });
    });
  }

  /* ---------- Aberto agora? (horário de Brasília) ---------- */
  function horaLocal() {
    try {
      var partes = new Intl.DateTimeFormat('en-US', {
        timeZone: cfg.fusoHorario || 'America/Sao_Paulo',
        weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
      }).formatToParts(new Date());
      var p = {};
      partes.forEach(function (x) { p[x.type] = x.value; });
      var dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      return { dia: dias[p.weekday], hora: Number(p.hour) + Number(p.minute) / 60 };
    } catch (e) {
      var d = new Date();
      return { dia: d.getDay(), hora: d.getHours() + d.getMinutes() / 60 };
    }
  }

  function fmtHora(h) {
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return hh + 'h' + (mm ? String(mm).padStart(2, '0') : '');
  }

  function statusFuncionamento() {
    var horarios = cfg.horarios || {};
    var agora = horaLocal();
    var hoje = horarios[agora.dia] || [];
    for (var i = 0; i < hoje.length; i += 2) {
      if (agora.hora >= hoje[i] && agora.hora < hoje[i + 1]) {
        return { aberto: true, texto: 'Aberto agora · fecha às ' + fmtHora(hoje[i + 1]) };
      }
    }
    var nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    for (var d = 0; d < 8; d++) {
      var dia = (agora.dia + d) % 7;
      var faixas = horarios[dia] || [];
      for (var j = 0; j < faixas.length; j += 2) {
        if (d === 0 && faixas[j] <= agora.hora) continue;
        var quando = d === 0 ? 'hoje' : d === 1 ? 'amanhã' : nomes[dia];
        return { aberto: false, texto: 'Fechado agora · abre ' + quando + ' às ' + fmtHora(faixas[j]) };
      }
    }
    return { aberto: false, texto: '' };
  }

  function mostrarStatus() {
    var s = statusFuncionamento();
    var dot = $('[data-status-dot]');
    var label = $('[data-status]');
    if (dot) dot.classList.toggle('is-open', s.aberto);
    if (label && s.aberto) label.textContent = 'Aberto agora · Dentista no Centro de Palhoça';
    $$('[data-status-inline]').forEach(function (el) {
      el.textContent = s.texto;
      el.classList.toggle('is-open', s.aberto);
    });
  }

  /* ---------- Depoimentos opcionais ---------- */
  function mostrarDepoimentos() {
    var lista = $('[data-review-list]');
    if (!lista || !cfg.depoimentos || !cfg.depoimentos.length) return;
    cfg.depoimentos.forEach(function (d) {
      var item = document.createElement('blockquote');
      item.className = 'review';
      var texto = document.createElement('p');
      texto.textContent = '“' + d.texto + '”';
      var autor = document.createElement('cite');
      autor.textContent = d.nome + ' · avaliação no Google';
      item.appendChild(texto);
      item.appendChild(autor);
      lista.appendChild(item);
    });
    lista.hidden = false;
  }

  /* ---------- Cabeçalho e menu ---------- */
  function prepararCabecalho() {
    var header = $('[data-header]');
    var toggle = $('[data-menu-toggle]');
    var nav = $('[data-nav]');

    var aoRolar = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
    aoRolar();
    window.addEventListener('scroll', aoRolar, { passive: true });

    function fechar() {
      document.body.classList.remove('menu-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Abrir menu');
    }
    toggle.addEventListener('click', function () {
      var aberto = document.body.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', String(aberto));
      toggle.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
    });
    nav.addEventListener('click', function (ev) { if (ev.target.closest('a')) fechar(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') fechar(); });
  }

  /* ---------- Animações de entrada ---------- */
  function prepararAnimacoes() {
    var itens = $$('.reveal');
    var reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduzir || !('IntersectionObserver' in window)) {
      itens.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-visible');
        obs.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    itens.forEach(function (el) { obs.observe(el); });
  }

  /* ---------- Formulário de agendamento ---------- */
  function mascaraTelefone(valor) {
    var d = valor.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 3) + ' ' + d.slice(3, 7) + '-' + d.slice(7);
  }

  function montarMensagem(dados) {
    var linhas = [
      'Olá, Dra. Pricila! Vim pelo site e gostaria de agendar um horário.',
      '',
      '*Nome:* ' + dados.nome,
      '*Interesse:* ' + dados.servico,
      '*Melhor período:* ' + dados.periodo
    ];
    if (dados.mensagem) linhas.push('*Mensagem:* ' + dados.mensagem);
    return linhas.join('\n');
  }

  function prepararFormulario() {
    var form = $('[data-booking-form]');
    if (!form) return;
    var abertoEm = Date.now();
    var erro = $('[data-form-error]', form);
    var botao = $('[data-submit]', form);
    var sucesso = $('[data-form-success]', form);
    var iniciou = false;

    var tel = $('[data-phone-mask]', form);
    tel.addEventListener('input', function () { tel.value = mascaraTelefone(tel.value); });

    form.addEventListener('focusin', function () {
      if (iniciou) return;
      iniciou = true;
      track('form_start', { formulario: 'agendamento' });
    });

    function mostrarErro(msg, campo) {
      erro.textContent = msg;
      erro.hidden = false;
      if (campo) {
        campo.setAttribute('aria-invalid', 'true');
        campo.focus();
      }
    }

    form.addEventListener('input', function (ev) {
      ev.target.removeAttribute('aria-invalid');
      erro.hidden = true;
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = form.elements;
      var dados = {
        nome: f.nome.value.trim(),
        telefone: f.telefone.value.replace(/\D/g, ''),
        servico: f.servico.value,
        periodo: f.periodo.value,
        mensagem: f.mensagem.value.trim(),
        consentimento: f.consentimento.checked,
        empresa: f.empresa.value,
        tempo: Date.now() - abertoEm,
        origem: origem,
        pagina: location.pathname
      };

      if (dados.nome.length < 2) return mostrarErro('Informe seu nome.', f.nome);
      if (dados.telefone.length < 10 || dados.telefone.length > 11) {
        return mostrarErro('Informe um WhatsApp válido com DDD.', f.telefone);
      }
      if (!dados.consentimento) return mostrarErro('Marque a autorização de contato para continuar.', f.consentimento);

      botao.disabled = true;
      botao.classList.add('is-loading');
      var urlWhats = waLink(montarMensagem(dados));

      function concluir(url) {
        track('generate_lead', { canal: 'formulario', posicao: 'agendamento', servico: dados.servico });
        $$('.form-row, .form-cols, .consent, [data-submit], .form-note', form).forEach(function (el) { el.hidden = true; });
        erro.hidden = true;
        $('[data-success-wa]', sucesso).href = url;
        sucesso.hidden = false;
        sucesso.focus();
        setTimeout(function () { window.location.href = url; }, 1400);
      }

      if (!cfg.api) return concluir(urlWhats);

      var controle = 'AbortController' in window ? new AbortController() : null;
      var limite = setTimeout(function () { if (controle) controle.abort(); }, 8000);
      fetch(cfg.api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados),
        signal: controle ? controle.signal : undefined
      }).then(function (res) {
        clearTimeout(limite);
        return res.json().catch(function () { return {}; }).then(function (corpo) {
          if (res.ok && corpo.ok) return concluir(corpo.whatsappUrl || urlWhats);
          if (res.status === 400 || res.status === 429) {
            botao.disabled = false;
            botao.classList.remove('is-loading');
            return mostrarErro(corpo.erro || 'Confira os dados e tente novamente.');
          }
          // Servidor indisponível: o paciente não pode ficar sem resposta.
          concluir(urlWhats);
        });
      }).catch(function () {
        clearTimeout(limite);
        concluir(urlWhats);
      });
    });
  }

  function iniciar() {
    window.__pzReady = true;
    prepararLinks();
    mostrarStatus();
    mostrarDepoimentos();
    prepararCabecalho();
    prepararAnimacoes();
    prepararFormulario();
    carregarTags();
    setInterval(mostrarStatus, 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
