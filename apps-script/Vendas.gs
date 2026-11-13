/**
 * Vendas.gs — cadastro, edição, consulta e exclusão lógica das vendas.
 *
 * Ao salvar uma venda o site envia a lista de parcelas já conferida na prévia.
 * Parcelas pagas nunca são alteradas por aqui: só as em aberto são
 * atualizadas, criadas ou desativadas, e isso exige `confirmarRecalculo: true`
 * quando a venda já tem alguma parcela paga.
 */

function acaoListVendas() {
  var hoje = hojeIso_();
  var vendas = lerVendas_();
  var parcelas = lerParcelas_();
  var porVenda = {};
  parcelas.forEach(function (p) { (porVenda[p.venda_id] = porVenda[p.venda_id] || []).push(p); });
  var lista = vendas.map(function (v) { return calcularVenda_(v, porVenda[v.id] || [], hoje); });
  lista.sort(function (a, b) { return (b.criado_em || '').localeCompare(a.criado_em || '') || b.id.localeCompare(a.id); });
  return { hoje: hoje, vendas: lista };
}

function acaoGetVenda(dados) {
  var hoje = hojeIso_();
  var venda = buscarVenda_(dados.id);
  var parcelas = lerParcelas_().filter(function (p) { return p.venda_id === venda.id; });
  parcelas.sort(function (a, b) { return a.numero - b.numero || a.vencimento.localeCompare(b.vencimento); });
  var r = calcularVenda_(venda, parcelas, hoje);
  r.parcelas = parcelas.map(function (p) { return enriquecerParcela_(p, hoje); });
  return { hoje: hoje, venda: r };
}

/** Valida e normaliza os campos de cadastro da venda. */
function validarVenda_(d) {
  var v = {
    cliente_nome: texto_(d.cliente_nome, 120),
    cliente_telefone: telefoneMascara_(d.cliente_telefone),
    cliente_cpf: texto_(d.cliente_cpf, 20),
    imovel: texto_(d.imovel, 200),
    valor_imovel: numero_(d.valor_imovel),
    tipo_condicao: texto_(d.tipo_condicao),
    valor_entrada: numero_(d.valor_entrada),
    num_parcelas: inteiro_(d.num_parcelas),
    primeiro_vencimento: dataIso_(d.primeiro_vencimento),
    periodicidade: texto_(d.periodicidade) || 'Mensal',
    corretor: texto_(d.corretor, 80),
    observacoes: texto_(d.observacoes, 1000)
  };
  if (!v.cliente_nome) falha_('Informe o nome do cliente.');
  if (!v.imovel) falha_('Informe o imóvel comprado.');
  if (v.valor_entrada === null || v.valor_entrada <= 0) falha_('O valor da entrada precisa ser maior que zero.');
  if (v.valor_imovel !== null && v.valor_imovel < 0) falha_('O valor do imóvel não pode ser negativo.');
  if (v.num_parcelas === null || v.num_parcelas < 1) falha_('O número de parcelas precisa ser um inteiro maior ou igual a 1.');
  if (v.num_parcelas > 240) falha_('Número de parcelas muito alto.');
  if (!v.primeiro_vencimento) falha_('Informe uma data válida para o primeiro vencimento.');
  if (TIPOS_CONDICAO.indexOf(v.tipo_condicao) < 0) falha_('Escolha o tipo de condição.');
  if (PERIODICIDADES.indexOf(v.periodicidade) < 0) falha_('Escolha a periodicidade.');
  v.valor_entrada = centavos_(v.valor_entrada);
  if (v.valor_imovel !== null) v.valor_imovel = centavos_(v.valor_imovel);
  return v;
}

function acaoSaveVenda(dados, usuario) {
  var agora = agoraTexto_();
  var campos = validarVenda_(dados);
  var id = texto_(dados.id);

  // Lista de parcelas: vem da prévia editável; se não vier, gera automaticamente.
  var parcelasNovas = null;
  if (Array.isArray(dados.parcelas)) {
    parcelasNovas = validarParcelas_(dados.parcelas);
  } else if (!id) {
    parcelasNovas = gerarParcelas_(campos.valor_entrada, campos.num_parcelas,
      campos.primeiro_vencimento, campos.periodicidade, dados.datas);
  }

  if (!id) {
    id = proximoId_('V', 4, lerVendas_(true));
    var registro = campos;
    registro.id = id;
    registro.num_parcelas = parcelasNovas.length;
    registro.ativo = true;
    registro.criado_em = agora;
    registro.criado_por = usuario.nome;
    registro.atualizado_em = agora;
    registro.atualizado_por = usuario.nome;
    inserirLinha_(ABA_VENDAS, registro);

    var proximo = Number(proximoId_('P', 5, lerParcelas_(true)).slice(1));
    inserirLinhas_(ABA_PARCELAS, parcelasNovas.map(function (p, i) {
      return novaParcela_(id, p, proximo + i, agora, usuario);
    }));
    registrarLog_(usuario, 'criar', 'venda', id, campos.cliente_nome + ' — ' + campos.imovel +
      ': entrada R$ ' + campos.valor_entrada.toFixed(2) + ' em ' + parcelasNovas.length + 'x');
    return { id: id };
  }

  var existente = buscarVenda_(id);
  var atualizacao = campos;
  atualizacao.atualizado_em = agora;
  atualizacao.atualizado_por = usuario.nome;
  var resumo = resumoDiferencas_(existente, campos);

  if (parcelasNovas) {
    var atuais = lerParcelas_().filter(function (p) { return p.venda_id === id; });
    var pagas = atuais.filter(function (p) { return p.status === 'Pago'; });
    var abertas = atuais.filter(function (p) { return p.status !== 'Pago'; });
    var idsPagas = {};
    pagas.forEach(function (p) { idsPagas[p.id] = true; });

    // Parcelas pagas são intocáveis: tiramos da lista qualquer item que aponte para elas.
    var abertasNovas = parcelasNovas.filter(function (p) { return !idsPagas[p.id]; });
    var mudou = parcelasMudaram_(abertas, abertasNovas);
    if (mudou && pagas.length && !booleano_(dados.confirmarRecalculo)) {
      falha_('Essa venda já tem ' + pagas.length + ' parcela(s) paga(s). Confirme para recalcular só as parcelas em aberto.', 'CONFIRMAR');
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
        inserirLinhas_(ABA_PARCELAS, paraInserir.map(function (p, i) { return novaParcela_(id, p, prox + i, agora, usuario); }));
      }
      resumo.push('parcelas em aberto recalculadas (' + abertasNovas.length + ' em aberto, ' + pagas.length + ' pagas mantidas)');
    }
    atualizacao.num_parcelas = pagas.length + abertasNovas.length;
  }

  atualizarLinha_(ABA_VENDAS, existente._linha, atualizacao);
  registrarLog_(usuario, 'editar', 'venda', id, campos.cliente_nome + ': ' + (resumo.length ? resumo.join('; ') : 'sem alterações'));
  return { id: id };
}

function novaParcela_(vendaId, p, sequencial, agora, usuario) {
  var n = String(sequencial);
  while (n.length < 5) n = '0' + n;
  return {
    id: 'P' + n, venda_id: vendaId, numero: p.numero, valor: p.valor, vencimento: p.vencimento,
    status: 'A pagar', data_pagamento: '', valor_pago: '', forma_pagamento: '',
    observacoes: p.observacoes || '', ativo: true,
    criado_em: agora, criado_por: usuario.nome, atualizado_em: agora, atualizado_por: usuario.nome
  };
}

function parcelasMudaram_(abertas, novas) {
  if (abertas.length !== novas.length) return true;
  var a = abertas.slice().sort(function (x, y) { return x.numero - y.numero; });
  return a.some(function (p, i) {
    var n = novas[i];
    return p.numero !== n.numero || Math.abs(p.valor - n.valor) > 0.005 || p.vencimento !== n.vencimento;
  });
}

function resumoDiferencas_(antes, depois) {
  var rotulos = {
    cliente_nome: 'cliente', cliente_telefone: 'telefone', cliente_cpf: 'CPF', imovel: 'imóvel',
    valor_imovel: 'valor do imóvel', tipo_condicao: 'tipo', valor_entrada: 'entrada', num_parcelas: 'nº parcelas',
    primeiro_vencimento: '1º vencimento', periodicidade: 'periodicidade', corretor: 'corretor', observacoes: 'observações'
  };
  var diffs = [];
  Object.keys(rotulos).forEach(function (k) {
    var a = antes[k] == null ? '' : String(antes[k]);
    var b = depois[k] == null ? '' : String(depois[k]);
    if (a !== b) diffs.push(rotulos[k] + ': "' + a + '" → "' + b + '"');
  });
  return diffs;
}

function acaoDeleteVenda(dados, usuario) {
  var venda = buscarVenda_(dados.id);
  var agora = agoraTexto_();
  var parcelas = lerParcelas_().filter(function (p) { return p.venda_id === venda.id; });
  parcelas.forEach(function (p) {
    atualizarLinha_(ABA_PARCELAS, p._linha, { ativo: false, atualizado_em: agora, atualizado_por: usuario.nome });
  });
  atualizarLinha_(ABA_VENDAS, venda._linha, { ativo: false, atualizado_em: agora, atualizado_por: usuario.nome });
  registrarLog_(usuario, 'excluir', 'venda', venda.id, venda.cliente_nome + ' — ' + venda.imovel +
    ' (' + parcelas.length + ' parcela(s) desativadas)');
  return { id: venda.id };
}
