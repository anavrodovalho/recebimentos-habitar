/**
 * Contratos.gs — Pagamentos (contas que a Habitar tem a pagar) e Empréstimos
 * (quantias que o Nizar, a Adriana ou a Habitar emprestaram e têm data para receber).
 *
 * Os dois funcionam como as vendas: um registro "pai" (db_pagamentos / db_emprestimos)
 * e suas parcelas na mesma aba db_parcelas, ligadas pela coluna venda_id, que aqui
 * guarda o código do pai. O prefixo do código diz de quem é a parcela:
 *   V0001  → venda      PG0001 → pagamento      EM0001 → empréstimo
 * Assim baixa, estorno, edição e exclusão de parcelas valem para os três sem código extra.
 */

/** Configuração de cada tipo. `campos`: t = texto, n = número, i = inteiro, d = data, b = booleano. */
function tiposContrato_() {
  return {
    pagamento: {
      chave: 'pagamento', aba: ABA_PAGAMENTOS, prefixo: 'PG', entidade: 'pagamento', rotulo: 'Pagamento',
      campoNome: 'favorecido', campoValor: 'valor_total', campoTelefone: '',
      campos: {
        favorecido: 't', descricao: 't', categoria: 't', valor_total: 'n', num_parcelas: 'i',
        primeiro_vencimento: 'd', periodicidade: 't', documento: 't', observacoes: 't'
      }
    },
    emprestimo: {
      chave: 'emprestimo', aba: ABA_EMPRESTIMOS, prefixo: 'EM', entidade: 'emprestimo', rotulo: 'Empréstimo',
      campoNome: 'devedor_nome', campoValor: 'valor_a_receber', campoTelefone: 'devedor_telefone',
      campos: {
        credor: 't', devedor_nome: 't', devedor_telefone: 't', devedor_cpf: 't', valor_emprestado: 'n',
        data_emprestimo: 'd', valor_a_receber: 'n', num_parcelas: 'i', primeiro_vencimento: 'd',
        periodicidade: 't', observacoes: 't'
      }
    }
  };
}

function tipoContrato_(chave) {
  var t = tiposContrato_()[texto_(chave)];
  if (!t) falha_('Tipo de registro inválido.');
  return t;
}

/** Descobre o tipo pelo prefixo do código (null para vendas). */
function tipoPorId_(id) {
  var t = texto_(id);
  if (/^PG\d+$/.test(t)) return tiposContrato_().pagamento;
  if (/^EM\d+$/.test(t)) return tiposContrato_().emprestimo;
  return null;
}

// ───────────────────────────── Leitura ─────────────────────────────

function contratoDaLinha_(tipo, l) {
  var r = { id: texto_(l.id), _linha: l._linha };
  Object.keys(tipo.campos).forEach(function (campo) {
    var t = tipo.campos[campo], v = l[campo];
    if (t === 'n') r[campo] = numero_(v);
    else if (t === 'i') r[campo] = inteiro_(v) || 1;
    else if (t === 'd') r[campo] = dataIso_(v);
    else r[campo] = texto_(v);
  });
  r.periodicidade = r.periodicidade || 'Mensal';
  r.ativo = booleano_(l.ativo);
  ['criado_em', 'criado_por', 'atualizado_em', 'atualizado_por'].forEach(function (c) { r[c] = texto_(l[c]); });
  return r;
}

function lerContratos_(tipo, incluirInativos) {
  return lerTabela_(tipo.aba).map(function (l) { return contratoDaLinha_(tipo, l); })
    .filter(function (c) { return c.id && (incluirInativos || c.ativo); });
}

function buscarContrato_(tipo, id) {
  var alvo = texto_(id);
  var c = lerContratos_(tipo).filter(function (x) { return x.id === alvo; })[0];
  if (!c) falha_(tipo.rotulo + ' não encontrado.');
  return c;
}

/** Venda, pagamento ou empréstimo dono de uma parcela, com um nome para os registros. */
function buscarReferencia_(id) {
  var tipo = tipoPorId_(id);
  if (!tipo) {
    var v = buscarVenda_(id);
    return { id: v.id, cliente_nome: v.cliente_nome };
  }
  var c = buscarContrato_(tipo, id);
  return { id: c.id, cliente_nome: c[tipo.campoNome] };
}

/** Contrato com o resumo financeiro (total pago/recebido, saldo, situação…). */
function calcularRegistroContrato_(tipo, c, parcelas, hoje) {
  var r = calcularContrato_(c, c[tipo.campoValor] || 0, parcelas, hoje);
  r.tipo = tipo.chave;
  r.nome = c[tipo.campoNome];
  r.valor_total_ref = c[tipo.campoValor] || 0;
  return r;
}

/** Parcela de pagamento/empréstimo no formato das listas (mesmos campos das parcelas de venda). */
function parcelaComContrato_(tipo, p, c, totalParcelas, hoje) {
  var r = enriquecerParcela_(p, hoje);
  r.tipo = tipo.chave;
  r.cliente_nome = c ? c[tipo.campoNome] : '';
  r.cliente_telefone = c && tipo.campoTelefone ? c[tipo.campoTelefone] : '';
  r.imovel = !c ? '' : tipo.chave === 'pagamento'
    ? [c.descricao, c.categoria].filter(Boolean).join(' · ')
    : 'Empréstimo' + (c.credor ? ' de ' + c.credor : '');
  r.total_parcelas_venda = totalParcelas;
  return r;
}

function acaoListContratos(dados) {
  var tipo = tipoContrato_(dados.tipo);
  var hoje = hojeIso_();
  var contratos = lerContratos_(tipo);
  var porRef = agruparParcelas_(lerParcelas_());
  var lista = contratos.map(function (c) { return calcularRegistroContrato_(tipo, c, porRef[c.id] || [], hoje); });
  lista.sort(function (a, b) { return (b.criado_em || '').localeCompare(a.criado_em || '') || b.id.localeCompare(a.id); });
  return { hoje: hoje, tipo: tipo.chave, registros: lista };
}

function acaoGetContrato(dados) {
  var tipo = tipoContrato_(dados.tipo);
  var hoje = hojeIso_();
  var c = buscarContrato_(tipo, dados.id);
  var parcelas = lerParcelas_().filter(function (p) { return p.venda_id === c.id; });
  parcelas.sort(function (a, b) { return a.numero - b.numero || a.vencimento.localeCompare(b.vencimento); });
  var r = calcularRegistroContrato_(tipo, c, parcelas, hoje);
  r.parcelas = parcelas.map(function (p) { return enriquecerParcela_(p, hoje); });
  return { hoje: hoje, registro: r };
}

function agruparParcelas_(parcelas) {
  var porRef = {};
  parcelas.forEach(function (p) { (porRef[p.venda_id] = porRef[p.venda_id] || []).push(p); });
  return porRef;
}

/**
 * Resumo de pagamentos e empréstimos para o Painel. Acrescenta em `atencao` as
 * parcelas atrasadas ou que vencem em até 7 dias.
 */
function resumoContratos_(parcelas, hoje, atencao) {
  var porRef = agruparParcelas_(parcelas);
  var saida = {};
  ['pagamento', 'emprestimo'].forEach(function (chave) {
    var tipo = tiposContrato_()[chave];
    var contratos;
    try { contratos = lerContratos_(tipo); } catch (e) { contratos = []; }
    var resumo = { em_aberto: 0, em_atraso: 0, parcelas_atrasadas: 0, vence_30_dias: 0, quitado: 0, registros_abertos: 0, registros_quitados: 0 };
    contratos.forEach(function (c) {
      var lista = porRef[c.id] || [];
      var calc = calcularContrato_(c, c[tipo.campoValor] || 0, lista, hoje);
      if (calc.situacao === 'Quitada') resumo.registros_quitados++; else resumo.registros_abertos++;
      lista.forEach(function (p) {
        if (p.status === 'Pago') { resumo.quitado += p.valor_pago != null ? p.valor_pago : p.valor; return; }
        var sit = situacaoParcela_(p, hoje);
        var faltam = p.vencimento ? diasEntre_(hoje, p.vencimento) : 9999;
        resumo.em_aberto += p.valor;
        if (sit === 'Atrasado') { resumo.em_atraso += p.valor; resumo.parcelas_atrasadas++; }
        if (faltam >= 0 && faltam <= 30) resumo.vence_30_dias += p.valor;
        if (sit === 'Atrasado' || sit === 'Vence em até 7 dias') atencao.push(parcelaComContrato_(tipo, p, c, lista.length, hoje));
      });
    });
    ['em_aberto', 'em_atraso', 'vence_30_dias', 'quitado'].forEach(function (k) { resumo[k] = centavos_(resumo[k]); });
    saida[chave] = resumo;
  });
  return saida;
}

// ───────────────────────────── Escrita ─────────────────────────────

function validarContrato_(tipo, d) {
  var v = {};
  Object.keys(tipo.campos).forEach(function (campo) {
    var t = tipo.campos[campo];
    if (t === 'n') v[campo] = numero_(d[campo]);
    else if (t === 'i') v[campo] = inteiro_(d[campo]);
    else if (t === 'd') v[campo] = dataIso_(d[campo]);
    else v[campo] = texto_(d[campo], campo === 'observacoes' ? 1000 : 200);
  });
  v.periodicidade = v.periodicidade || 'Mensal';

  if (tipo.chave === 'pagamento') {
    if (!v.favorecido) falha_('Informe a quem vamos pagar (favorecido).');
    if (!v.descricao) falha_('Informe a descrição do pagamento.');
    if (v.valor_total === null || v.valor_total <= 0) falha_('O valor total precisa ser maior que zero.');
    v.valor_total = centavos_(v.valor_total);
  } else {
    if (!v.credor) falha_('Informe quem emprestou.');
    if (!v.devedor_nome) falha_('Informe para quem foi o empréstimo.');
    if (v.valor_emprestado === null || v.valor_emprestado <= 0) falha_('O valor emprestado precisa ser maior que zero.');
    if (v.valor_a_receber === null) v.valor_a_receber = v.valor_emprestado;
    if (v.valor_a_receber <= 0) falha_('O valor a receber precisa ser maior que zero.');
    if (!v.data_emprestimo) v.data_emprestimo = hojeIso_();
    v.devedor_telefone = telefoneMascara_(v.devedor_telefone);
    v.valor_emprestado = centavos_(v.valor_emprestado);
    v.valor_a_receber = centavos_(v.valor_a_receber);
  }
  if (v.num_parcelas === null || v.num_parcelas < 1) falha_('O número de parcelas precisa ser um inteiro maior ou igual a 1.');
  if (v.num_parcelas > 240) falha_('Número de parcelas muito alto.');
  if (!v.primeiro_vencimento) falha_('Informe uma data válida para o primeiro vencimento.');
  if (PERIODICIDADES.indexOf(v.periodicidade) < 0) falha_('Escolha a periodicidade.');
  return v;
}

function acaoSaveContrato(dados, usuario) {
  var tipo = tipoContrato_(dados.tipo);
  var agora = agoraTexto_();
  var campos = validarContrato_(tipo, dados);
  var id = texto_(dados.id);
  var valorTotal = campos[tipo.campoValor];
  var nome = campos[tipo.campoNome];

  var parcelasNovas = null;
  if (Array.isArray(dados.parcelas)) parcelasNovas = validarParcelas_(dados.parcelas);
  else if (!id) parcelasNovas = gerarParcelas_(valorTotal, campos.num_parcelas, campos.primeiro_vencimento, campos.periodicidade, dados.datas);

  if (!id) {
    id = proximoId_(tipo.prefixo, 4, lerContratos_(tipo, true));
    var registro = campos;
    registro.id = id;
    registro.num_parcelas = parcelasNovas.length;
    registro.ativo = true;
    registro.criado_em = agora; registro.criado_por = usuario.nome;
    registro.atualizado_em = agora; registro.atualizado_por = usuario.nome;
    inserirLinha_(tipo.aba, registro);
    var proximo = Number(proximoId_('P', 5, lerParcelas_(true)).slice(1));
    inserirLinhas_(ABA_PARCELAS, parcelasNovas.map(function (p, i) { return novaParcela_(id, p, proximo + i, agora, usuario); }));
    registrarLog_(usuario, 'criar', tipo.entidade, id, resumoContrato_(tipo, campos, parcelasNovas.length));
    return { id: id };
  }

  var existente = buscarContrato_(tipo, id);
  var atualizacao = campos;
  atualizacao.atualizado_em = agora;
  atualizacao.atualizado_por = usuario.nome;
  var mudancas = [];
  Object.keys(tipo.campos).forEach(function (k) {
    var a = existente[k] == null ? '' : String(existente[k]);
    var b = campos[k] == null ? '' : String(campos[k]);
    if (a !== b) mudancas.push(k + ': "' + a + '" → "' + b + '"');
  });
  if (parcelasNovas) {
    var sinc = sincronizarParcelas_(id, parcelasNovas, booleano_(dados.confirmarRecalculo), agora, usuario);
    if (sinc.mudou) mudancas.push('parcelas em aberto recalculadas (' + sinc.abertas + ' em aberto, ' + sinc.pagas + ' pagas mantidas)');
    atualizacao.num_parcelas = sinc.pagas + sinc.abertas;
  }
  atualizarLinha_(tipo.aba, existente._linha, atualizacao);
  registrarLog_(usuario, 'editar', tipo.entidade, id, nome + ': ' + (mudancas.length ? mudancas.join('; ') : 'sem alterações'));
  return { id: id };
}

function resumoContrato_(tipo, c, qtd) {
  if (tipo.chave === 'pagamento') {
    return 'Pagar a ' + c.favorecido + ' — ' + c.descricao + ': R$ ' + c.valor_total.toFixed(2) + ' em ' + qtd + 'x';
  }
  return 'Empréstimo de ' + c.credor + ' para ' + c.devedor_nome + ': R$ ' + c.valor_emprestado.toFixed(2) +
    ' (a receber R$ ' + c.valor_a_receber.toFixed(2) + ') em ' + qtd + 'x';
}

function acaoDeleteContrato(dados, usuario) {
  var tipo = tipoContrato_(dados.tipo);
  var c = buscarContrato_(tipo, dados.id);
  var agora = agoraTexto_();
  var parcelas = lerParcelas_().filter(function (p) { return p.venda_id === c.id; });
  parcelas.forEach(function (p) {
    atualizarLinha_(ABA_PARCELAS, p._linha, { ativo: false, atualizado_em: agora, atualizado_por: usuario.nome });
  });
  atualizarLinha_(tipo.aba, c._linha, { ativo: false, atualizado_em: agora, atualizado_por: usuario.nome });
  registrarLog_(usuario, 'excluir', tipo.entidade, c.id, c[tipo.campoNome] + ' (' + parcelas.length + ' parcela(s) desativadas)');
  return { id: c.id };
}

/**
 * Sincroniza as parcelas de um registro (venda, pagamento ou empréstimo) com a lista
 * vinda da prévia. Parcelas pagas nunca mudam. Exige confirmação quando há pagas.
 */
function sincronizarParcelas_(refId, parcelasNovas, confirmado, agora, usuario) {
  var atuais = lerParcelas_().filter(function (p) { return p.venda_id === refId; });
  var pagas = atuais.filter(function (p) { return p.status === 'Pago'; });
  var abertas = atuais.filter(function (p) { return p.status !== 'Pago'; });
  var idsPagas = {};
  pagas.forEach(function (p) { idsPagas[p.id] = true; });

  var abertasNovas = parcelasNovas.filter(function (p) { return !idsPagas[p.id]; });
  var mudou = parcelasMudaram_(abertas, abertasNovas);
  if (mudou && pagas.length && !confirmado) {
    falha_('Este registro já tem ' + pagas.length + ' parcela(s) paga(s). Confirme para recalcular só as parcelas em aberto.', 'CONFIRMAR');
  }
  if (mudou) {
    var porId = {};
    abertas.forEach(function (p) { porId[p.id] = p; });
    var mantidas = {};
    var paraInserir = [];
    abertasNovas.forEach(function (p) {
      if (p.id && porId[p.id]) {
        mantidas[p.id] = true;
        atualizarLinha_(ABA_PARCELAS, porId[p.id]._linha, {
          numero: p.numero, valor: p.valor, vencimento: p.vencimento,
          observacoes: p.observacoes || porId[p.id].observacoes,
          atualizado_em: agora, atualizado_por: usuario.nome
        });
      } else {
        paraInserir.push(p);
      }
    });
    abertas.forEach(function (p) {
      if (!mantidas[p.id]) atualizarLinha_(ABA_PARCELAS, p._linha, { ativo: false, atualizado_em: agora, atualizado_por: usuario.nome });
    });
    if (paraInserir.length) {
      var prox = Number(proximoId_('P', 5, lerParcelas_(true)).slice(1));
      inserirLinhas_(ABA_PARCELAS, paraInserir.map(function (p, i) { return novaParcela_(refId, p, prox + i, agora, usuario); }));
    }
  }
  return { mudou: mudou, pagas: pagas.length, abertas: abertasNovas.length };
}
