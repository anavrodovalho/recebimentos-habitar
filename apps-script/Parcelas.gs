/**
 * Parcelas.gs — regras de negócio das parcelas, painel e baixas.
 *
 * Situação da parcela:
 *   Pago                 → status = Pago
 *   Atrasado             → vencimento já passou
 *   Vence em até 7 dias  → faltam de 0 a 7 dias
 *   A vencer             → nos demais casos
 * "Hoje" é sempre calculado no fuso America/Sao_Paulo.
 */

// ───────────────────────────── Cálculos ─────────────────────────────

function situacaoParcela_(p, hoje) {
  if (p.status === 'Pago') return 'Pago';
  if (!p.vencimento) return 'A vencer';
  var faltam = diasEntre_(hoje, p.vencimento);
  if (faltam < 0) return 'Atrasado';
  if (faltam <= DIAS_ALERTA_VENCIMENTO) return 'Vence em até 7 dias';
  return 'A vencer';
}

function diasAtraso_(p, hoje) {
  if (p.status === 'Pago' || !p.vencimento) return 0;
  var dias = diasEntre_(p.vencimento, hoje);
  return dias > 0 ? dias : 0;
}

/** Devolve a parcela com os campos calculados (situacao, dias_atraso). */
function enriquecerParcela_(p, hoje) {
  var r = publico_(p);
  r.situacao = situacaoParcela_(p, hoje);
  r.dias_atraso = diasAtraso_(p, hoje);
  return r;
}

/** Resumo financeiro de uma venda a partir das suas parcelas ativas. */
function calcularVenda_(v, parcelas, hoje) {
  var r = publico_(v);
  var pagas = parcelas.filter(function (p) { return p.status === 'Pago'; });
  var abertas = parcelas.filter(function (p) { return p.status !== 'Pago'; });

  r.total_parcelas = parcelas.length;
  r.parcelas_pagas = pagas.length;
  r.total_recebido = centavos_(pagas.reduce(function (s, p) {
    return s + (p.valor_pago != null ? p.valor_pago : p.valor);
  }, 0));
  // Saldo = soma das parcelas em aberto (e não entrada − recebido), para juros ou
  // descontos lançados em valor_pago não distorcerem o que ainda falta receber.
  r.saldo = centavos_(abertas.reduce(function (s, p) { return s + p.valor; }, 0));
  r.soma_parcelas = centavos_(parcelas.reduce(function (s, p) { return s + p.valor; }, 0));
  r.conferencia_ok = Math.abs(r.soma_parcelas - v.valor_entrada) < 0.005;

  var atrasadas = abertas.filter(function (p) { return situacaoParcela_(p, hoje) === 'Atrasado'; });
  r.parcelas_atrasadas = atrasadas.length;
  r.maior_atraso = atrasadas.reduce(function (m, p) { return Math.max(m, diasAtraso_(p, hoje)); }, 0);

  var proximas = abertas.map(function (p) { return p.vencimento; }).filter(Boolean).sort();
  r.proximo_vencimento = proximas[0] || '';

  if (parcelas.length && !abertas.length) r.situacao = 'Quitada';
  else if (atrasadas.length) r.situacao = 'Em atraso';
  else r.situacao = 'Em dia';
  return r;
}

/**
 * Gera as parcelas de uma venda: divide o valor igualmente e joga a diferença
 * de centavos na última parcela. Em "Personalizada" as datas vêm de `datas`.
 */
function gerarParcelas_(valorTotal, quantidade, primeiroVencimento, periodicidade, datas) {
  var base = Math.floor((valorTotal * 100) / quantidade) / 100;
  var parcelas = [];
  for (var i = 0; i < quantidade; i++) {
    var vencimento;
    if (periodicidade === 'Personalizada') vencimento = dataIso_(datas && datas[i]);
    else if (periodicidade === 'Quinzenal') vencimento = somarDias_(primeiroVencimento, 15 * i);
    else vencimento = somarMeses_(primeiroVencimento, i);
    parcelas.push({ numero: i + 1, valor: base, vencimento: vencimento });
  }
  var somaBase = centavos_(base * quantidade);
  parcelas[quantidade - 1].valor = centavos_(base + (valorTotal - somaBase));
  return parcelas;
}

/** Valida e normaliza uma lista de parcelas vinda do site. */
function validarParcelas_(lista) {
  if (!Array.isArray(lista) || !lista.length) falha_('Informe pelo menos uma parcela.');
  var numeros = {};
  return lista.map(function (p, i) {
    var numero = inteiro_(p.numero) || (i + 1);
    var valor = numero_(p.valor);
    var vencimento = dataIso_(p.vencimento);
    if (valor === null || valor <= 0) falha_('A parcela ' + numero + ' precisa ter valor maior que zero.');
    if (!vencimento) falha_('A parcela ' + numero + ' está sem data de vencimento válida.');
    if (numeros[numero]) falha_('O número de parcela ' + numero + ' está repetido.');
    numeros[numero] = true;
    return { id: texto_(p.id), numero: numero, valor: centavos_(valor), vencimento: vencimento, observacoes: texto_(p.observacoes, 500) };
  }).sort(function (a, b) { return a.numero - b.numero; });
}

// ───────────────────────────── Leitura ─────────────────────────────

function mapaVendas_(vendas) {
  var mapa = {};
  vendas.forEach(function (v) { mapa[v.id] = v; });
  return mapa;
}

/** Parcela com os dados da venda (cliente, imóvel, telefone) para as listas. */
function parcelaComVenda_(p, venda, hoje) {
  var r = enriquecerParcela_(p, hoje);
  r.cliente_nome = venda ? venda.cliente_nome : '';
  r.cliente_telefone = venda ? venda.cliente_telefone : '';
  r.imovel = venda ? venda.imovel : '';
  r.corretor = venda ? venda.corretor : '';
  r.total_parcelas_venda = venda ? venda._total_parcelas : 0;
  return r;
}

function acaoListParcelas() {
  var hoje = hojeIso_();
  var vendas = lerVendas_();
  var parcelas = lerParcelas_();
  var contagem = {};
  parcelas.forEach(function (p) { contagem[p.venda_id] = (contagem[p.venda_id] || 0) + 1; });
  vendas.forEach(function (v) { v._total_parcelas = contagem[v.id] || 0; });
  var mapa = mapaVendas_(vendas);
  var lista = parcelas
    .filter(function (p) { return mapa[p.venda_id]; })
    .map(function (p) { return parcelaComVenda_(p, mapa[p.venda_id], hoje); });
  lista.sort(function (a, b) { return (a.vencimento || '').localeCompare(b.vencimento || '') || a.numero - b.numero; });
  return { hoje: hoje, parcelas: lista };
}

function acaoGetDashboard() {
  var hoje = hojeIso_();
  var vendas = lerVendas_();
  var parcelas = lerParcelas_();
  var mapa = mapaVendas_(vendas);
  parcelas = parcelas.filter(function (p) { return mapa[p.venda_id]; });

  var porVenda = {};
  parcelas.forEach(function (p) { (porVenda[p.venda_id] = porVenda[p.venda_id] || []).push(p); });

  var cards = {
    total_a_receber: 0, total_recebido: 0, valor_em_atraso: 0, a_vencer_30_dias: 0,
    vendas_em_aberto: 0, vendas_quitadas: 0, parcelas_atrasadas: 0, parcelas_7_dias: 0
  };
  var atencao = [];
  var contagem = {};
  parcelas.forEach(function (p) { contagem[p.venda_id] = (contagem[p.venda_id] || 0) + 1; });
  vendas.forEach(function (v) { v._total_parcelas = contagem[v.id] || 0; });

  parcelas.forEach(function (p) {
    var sit = situacaoParcela_(p, hoje);
    if (p.status === 'Pago') {
      cards.total_recebido += p.valor_pago != null ? p.valor_pago : p.valor;
      return;
    }
    cards.total_a_receber += p.valor;
    var faltam = p.vencimento ? diasEntre_(hoje, p.vencimento) : 9999;
    if (sit === 'Atrasado') { cards.valor_em_atraso += p.valor; cards.parcelas_atrasadas++; }
    if (sit === 'Vence em até 7 dias') cards.parcelas_7_dias++;
    if (faltam >= 0 && faltam <= 30) cards.a_vencer_30_dias += p.valor;
    if (sit === 'Atrasado' || sit === 'Vence em até 7 dias') atencao.push(parcelaComVenda_(p, mapa[p.venda_id], hoje));
  });
  Object.keys(cards).forEach(function (k) { cards[k] = centavos_(cards[k]); });

  vendas.forEach(function (v) {
    var calc = calcularVenda_(v, porVenda[v.id] || [], hoje);
    if (calc.situacao === 'Quitada') cards.vendas_quitadas++; else cards.vendas_em_aberto++;
  });

  // Atrasadas primeiro (mais antigas no topo), depois as que vencem em breve.
  atencao.sort(function (a, b) {
    var pa = a.situacao === 'Atrasado' ? 0 : 1, pb = b.situacao === 'Atrasado' ? 0 : 1;
    return pa - pb || a.vencimento.localeCompare(b.vencimento);
  });

  return { hoje: hoje, cards: cards, previsao: previsaoMensal_(parcelas, hoje), atencao: atencao };
}

/** Previsto × recebido por mês de vencimento, do mês atual até 11 meses à frente. */
function previsaoMensal_(parcelas, hoje) {
  var meses = [];
  var indice = {};
  var inicio = hoje.slice(0, 7) + '-01';
  for (var i = 0; i < 12; i++) {
    var chave = somarMeses_(inicio, i).slice(0, 7);
    indice[chave] = meses.length;
    meses.push({ mes: chave, previsto: 0, recebido: 0 });
  }
  var anteriores = { previsto: 0, recebido: 0 };
  parcelas.forEach(function (p) {
    if (!p.vencimento) return;
    var chave = p.vencimento.slice(0, 7);
    var alvo = indice[chave] != null ? meses[indice[chave]] : (chave < inicio.slice(0, 7) ? anteriores : null);
    if (!alvo) return;
    alvo.previsto += p.valor;
    if (p.status === 'Pago') alvo.recebido += p.valor_pago != null ? p.valor_pago : p.valor;
  });
  meses.forEach(function (m) { m.previsto = centavos_(m.previsto); m.recebido = centavos_(m.recebido); });
  anteriores.previsto = centavos_(anteriores.previsto);
  anteriores.recebido = centavos_(anteriores.recebido);
  return { meses: meses, anteriores: anteriores };
}

// ───────────────────────────── Escrita ─────────────────────────────

function buscarParcela_(id) {
  var alvo = texto_(id);
  var p = lerParcelas_().filter(function (x) { return x.id === alvo; })[0];
  if (!p) falha_('Parcela não encontrada.');
  return p;
}

function buscarVenda_(id) {
  var alvo = texto_(id);
  var v = lerVendas_().filter(function (x) { return x.id === alvo; })[0];
  if (!v) falha_('Venda não encontrada.');
  return v;
}

function validarPagamento_(dados, valorParcela) {
  var data = dataIso_(dados.data_pagamento) || hojeIso_();
  var valorPago = dados.valor_pago === '' || dados.valor_pago == null ? valorParcela : numero_(dados.valor_pago);
  if (valorPago === null || valorPago <= 0) falha_('O valor pago precisa ser maior que zero.');
  var forma = texto_(dados.forma_pagamento);
  if (FORMAS_PAGAMENTO.indexOf(forma) < 0) falha_('Escolha a forma de pagamento.');
  return { data_pagamento: data, valor_pago: centavos_(valorPago), forma_pagamento: forma };
}

/** Cria ou edita uma parcela avulsa. */
function acaoSaveParcela(dados, usuario) {
  var agora = agoraTexto_();
  var venda = buscarVenda_(dados.venda_id);
  var campos = validarParcelas_([dados])[0];
  var status = texto_(dados.status) === 'Pago' ? 'Pago' : 'A pagar';
  var registro = {
    venda_id: venda.id,
    numero: campos.numero,
    valor: campos.valor,
    vencimento: campos.vencimento,
    status: status,
    observacoes: campos.observacoes,
    atualizado_em: agora,
    atualizado_por: usuario.nome
  };
  if (status === 'Pago') {
    var pg = validarPagamento_(dados, campos.valor);
    registro.data_pagamento = pg.data_pagamento;
    registro.valor_pago = pg.valor_pago;
    registro.forma_pagamento = pg.forma_pagamento;
  } else {
    registro.data_pagamento = '';
    registro.valor_pago = '';
    registro.forma_pagamento = '';
  }

  var id = texto_(dados.id);
  if (id) {
    var existente = buscarParcela_(id);
    if (existente.venda_id !== venda.id) falha_('A parcela não pertence a essa venda.');
    atualizarLinha_(ABA_PARCELAS, existente._linha, registro);
    registrarLog_(usuario, 'editar', 'parcela', id, 'Parcela ' + campos.numero + ' de ' + venda.cliente_nome +
      ': R$ ' + campos.valor.toFixed(2) + ' venc. ' + campos.vencimento + ' (' + status + ')');
  } else {
    id = proximoId_('P', 5, lerParcelas_(true));
    registro.id = id;
    registro.ativo = true;
    registro.criado_em = agora;
    registro.criado_por = usuario.nome;
    inserirLinha_(ABA_PARCELAS, registro);
    registrarLog_(usuario, 'criar', 'parcela', id, 'Parcela ' + campos.numero + ' de ' + venda.cliente_nome +
      ': R$ ' + campos.valor.toFixed(2) + ' venc. ' + campos.vencimento);
  }
  return { id: id };
}

function acaoBaixarParcela(dados, usuario) {
  var p = buscarParcela_(dados.id);
  if (p.status === 'Pago') falha_('Essa parcela já está paga.');
  var pg = validarPagamento_(dados, p.valor);
  var registro = {
    status: 'Pago',
    data_pagamento: pg.data_pagamento,
    valor_pago: pg.valor_pago,
    forma_pagamento: pg.forma_pagamento,
    atualizado_em: agoraTexto_(),
    atualizado_por: usuario.nome
  };
  if (dados.observacoes != null) registro.observacoes = texto_(dados.observacoes, 500);
  atualizarLinha_(ABA_PARCELAS, p._linha, registro);
  registrarLog_(usuario, 'baixa', 'parcela', p.id, 'Parcela ' + p.numero + ' da venda ' + p.venda_id +
    ' paga em ' + pg.data_pagamento + ': R$ ' + pg.valor_pago.toFixed(2) + ' via ' + pg.forma_pagamento);
  return { id: p.id };
}

function acaoEstornarParcela(dados, usuario) {
  var p = buscarParcela_(dados.id);
  if (p.status !== 'Pago') falha_('Essa parcela não está paga.');
  atualizarLinha_(ABA_PARCELAS, p._linha, {
    status: 'A pagar', data_pagamento: '', valor_pago: '', forma_pagamento: '',
    atualizado_em: agoraTexto_(), atualizado_por: usuario.nome
  });
  registrarLog_(usuario, 'estorno', 'parcela', p.id, 'Estorno da parcela ' + p.numero + ' da venda ' + p.venda_id +
    ' (era R$ ' + Number(p.valor_pago || p.valor).toFixed(2) + ' em ' + p.data_pagamento + ')');
  return { id: p.id };
}

function acaoDeleteParcela(dados, usuario) {
  var p = buscarParcela_(dados.id);
  if (p.status === 'Pago') falha_('Estorne a baixa antes de excluir uma parcela paga.');
  atualizarLinha_(ABA_PARCELAS, p._linha, { ativo: false, atualizado_em: agoraTexto_(), atualizado_por: usuario.nome });
  registrarLog_(usuario, 'excluir', 'parcela', p.id, 'Parcela ' + p.numero + ' da venda ' + p.venda_id +
    ' excluída (R$ ' + p.valor.toFixed(2) + ' venc. ' + p.vencimento + ')');
  return { id: p.id };
}
