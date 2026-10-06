/*
 * Dados do consultório usados pelo site.
 * Edite aqui: telefone, WhatsApp, horários, CRO, links e rastreamento.
 * Os textos fixos do index.html (telefone, endereço e horário) servem para o
 * Google e para quem navega sem JavaScript; mantenha-os iguais a estes dados.
 */
window.SITE_CONFIG = {
  nome: 'Dra. Pricila C. Zibell',

  // CRO é obrigatório na divulgação odontológica (Código de Ética do CFO).
  // Preencha antes de publicar, por exemplo: 'CRO/SC 12345'.
  cro: '',

  telefone: {
    exibicao: '(48) 3242-9297',
    link: '+554832429297'
  },

  // Número do WhatsApp com DDI e DDD, só dígitos.
  whatsapp: '554832429297',
  mensagemPadrao: 'Olá, Dra. Pricila! Vim pelo site e gostaria de agendar uma avaliação.',

  endereco: 'R. Vinte e Quatro de Abril, 2970 - Centro, Palhoça - SC, 88131-030',
  perfilGoogle: 'https://share.google/zeeptKOuTZrdBOkpw',

  // Horário por dia da semana (0 = domingo … 6 = sábado), em horas decimais.
  // Ex.: [8, 12, 13.5, 18] = das 8h às 12h e das 13h30 às 18h.
  horarios: {
    1: [8, 18],
    2: [8, 18],
    3: [8, 18],
    4: [8, 18],
    5: [8, 18]
  },
  horarioTexto: 'Segunda a sexta, das 8h às 18h',
  fusoHorario: 'America/Sao_Paulo',

  // Depoimentos copiados (com permissão) das avaliações do Google.
  // Formato: { nome: 'Maria S.', texto: '…' }. Lista vazia = bloco oculto.
  depoimentos: [],
  totalAvaliacoes: 5,

  // Rastreamento (opcional). Ex.: 'GTM-XXXXXXX' ou 'G-XXXXXXXXXX'.
  googleTagManager: '',
  googleAnalytics: '',

  // Endereço da API de agendamento. Em hospedagem só estática, deixe '' e o
  // formulário abre o WhatsApp direto com os dados preenchidos.
  api: '/api/agendamento'
};
