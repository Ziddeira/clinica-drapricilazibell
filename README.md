# Site · Dra. Pricila C. Zibell · Odontologia

Site de página única feito para converter visitas em agendamentos para o
consultório da R. Vinte e Quatro de Abril, 2970, Centro, Palhoça/SC.
O caminho principal é o WhatsApp, com o telefone e as rotas como apoio.

| Pasta / arquivo | Para quê |
|---|---|
| `public/index.html` | Página principal (textos, seções, SEO e dados estruturados) |
| `public/js/config.js` | **Dados editáveis**: WhatsApp, telefone, horários, CRO, depoimentos, Google Analytics |
| `public/css/style.css` | Identidade visual (rosa do logo, Cormorant Garamond e Montserrat) |
| `public/js/main.js` | Links de WhatsApp por tratamento, "aberto agora", formulário, rastreamento |
| `public/admin.html` | Painel de pedidos de agendamento (`/admin`) |
| `public/privacidade.html` | Política de Privacidade (LGPD) |
| `server.js` | Servidor Node sem dependências: arquivos, API de agendamento e painel |
| `test/` | Testes da API (`npm test`) |

## Como o site converte

1. **WhatsApp em todo lugar.** Botão no topo, no hero, em cada tratamento, na
   barra fixa do celular e no botão flutuante do computador. Cada link já
   abre com uma mensagem pronta e cita o tratamento clicado.
2. **Prova social logo de cara.** Nota 5,0 do Google no hero, na faixa de
   confiança e na seção de avaliações, com link para as avaliações reais.
3. **Quebra de objeções.** Seção "Talvez você esteja aqui porque…", passo a
   passo da consulta e perguntas frequentes (medo, dor, pagamento, clareamento).
4. **Formulário de 1 minuto.** Grava o pedido no servidor e continua no
   WhatsApp com os dados preenchidos. Se o servidor cair, abre o WhatsApp do
   mesmo jeito: nenhum paciente fica sem resposta.
5. **"Aberto agora".** Mostra em tempo real se o consultório está aberto,
   pelo horário de Brasília.
6. **Rápido e sem dependências externas.** Fontes hospedadas no próprio site,
   imagens leves e mapa carregado só quando aparece na tela.

## Antes de publicar (obrigatório)

- [ ] **CRO**: preencher `cro` em `public/js/config.js` (ex.: `'CRO/SC 12345'`).
      O Código de Ética Odontológica exige nome e CRO em toda divulgação.
- [ ] **WhatsApp**: confirmar o número. Está o mesmo do telefone fixo
      (48) 3242-9297, que é o que aparece no Perfil da Empresa do Google.
      Se for outro, troque `whatsapp` no `config.js` e `WHATSAPP_NUMBER` no `.env`.
- [ ] **Horário**: confirmar os dias e horários (hoje: segunda a sexta, 8h às 18h)
      em `config.js` e no bloco `openingHoursSpecification` do `index.html`.
- [ ] **Tratamentos**: conferir se os 8 tratamentos da seção são realmente
      oferecidos; remova ou troque os que não forem.
- [ ] **Domínio**: o site usa `https://pricilazibell.com.br`. Se o domínio for
      outro, troque em `index.html`, `privacidade.html`, `robots.txt` e `sitemap.xml`.
- [ ] **Foto da Dra.** (recomendado, aumenta a confiança): salve um retrato 4:5
      em `public/img/dra-pricila.jpg` e siga o comentário na seção "Sobre" do `index.html`.
- [ ] **Depoimentos** (opcional): copie 2 ou 3 avaliações do Google, com
      permissão, para a lista `depoimentos` do `config.js`.

## Rodar localmente

```bash
cd clinica-drapricilazibell
cp .env.example .env        # defina ADMIN_TOKEN
npm start                   # http://localhost:3000
npm test                    # testes da API
```

Precisa só do Node.js 18 ou mais novo. Não há `npm install`.

## Publicar

**Com o servidor (recomendado)**: Render, Railway, Fly.io, uma VPS ou a
Hostinger com Node. Comando de início `npm start`, variáveis do `.env.example`
e um disco persistente apontado em `DATA_DIR` para os pedidos não sumirem a
cada deploy. Atrás de Cloudflare ou outro proxy, use `TRUST_PROXY=1`.

**Só estático** (Netlify, Vercel, GitHub Pages, hospedagem comum): publique a
pasta `public/` e deixe `api: ''` no `config.js`. O formulário passa a abrir o
WhatsApp direto, sem gravar no painel.

## Painel de pedidos

Acesse `/admin` e entre com o `ADMIN_TOKEN`. Dá para ver de onde veio cada
pedido (Instagram, Google Ads…), chamar o paciente no WhatsApp com um clique,
marcar como contatado / agendado / perdido e exportar CSV para Excel.

Para receber um aviso a cada pedido, coloque em `LEAD_WEBHOOK_URL` um webhook
do Make, Zapier, n8n, Slack, Discord ou Google Chat.

## Medir resultados

Preencha `googleTagManager` ou `googleAnalytics` no `config.js`. O site envia:

| Evento | Quando |
|---|---|
| `generate_lead` | Clique em WhatsApp ou telefone, e envio do formulário (`canal`, `posicao`, `servico`) |
| `contact_intent` | Clique em rotas ou no Perfil do Google |
| `form_start` | Primeira interação com o formulário |

Marque `generate_lead` como conversão no GA4 e importe para o Google Ads.
Use links com `utm_source` / `utm_campaign` no Instagram e nos anúncios: a
origem aparece no painel junto de cada pedido.
