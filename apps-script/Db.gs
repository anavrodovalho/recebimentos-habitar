/**
 * Db.gs — leitura e escrita genérica das abas db_*.
 *
 * Cada aba tem o cabeçalho na linha 1. As funções localizam as colunas pelo
 * nome do cabeçalho (nunca pela posição) e leem a aba inteira com um único
 * getDataRange().getValues() por chamada.
 */

/** Cabeçalho (linha 1) de cada aba do banco. */
function cabecalhos_(nome) {
  switch (nome) {
    case ABA_VENDAS: return [
      'id', 'cliente_nome', 'cliente_telefone', 'cliente_cpf', 'imovel', 'valor_imovel',
      'tipo_condicao', 'valor_entrada', 'num_parcelas', 'primeiro_vencimento', 'periodicidade',
      'corretor', 'observacoes', 'ativo', 'criado_em', 'criado_por', 'atualizado_em', 'atualizado_por'
    ];
    case ABA_PARCELAS: return [
      'id', 'venda_id', 'numero', 'valor', 'vencimento', 'status', 'data_pagamento', 'valor_pago',
      'forma_pagamento', 'observacoes', 'ativo', 'criado_em', 'criado_por', 'atualizado_em', 'atualizado_por'
    ];
    case ABA_USUARIOS: return ['usuario', 'nome', 'senha_hash', 'perfil', 'ativo'];
    case ABA_LOG: return ['data_hora', 'usuario', 'acao', 'entidade', 'registro_id', 'resumo_alteracao'];
    case ABA_PAGAMENTOS: return [
      'id', 'favorecido', 'descricao', 'categoria', 'valor_total', 'num_parcelas', 'primeiro_vencimento',
      'periodicidade', 'documento', 'observacoes', 'ativo', 'criado_em', 'criado_por', 'atualizado_em', 'atualizado_por'
    ];
    case ABA_EMPRESTIMOS: return [
      'id', 'credor', 'devedor_nome', 'devedor_telefone', 'devedor_cpf', 'valor_emprestado', 'data_emprestimo',
      'valor_a_receber', 'num_parcelas', 'primeiro_vencimento', 'periodicidade', 'observacoes',
      'ativo', 'criado_em', 'criado_por', 'atualizado_em', 'atualizado_por'
    ];
    default: throw new Error('Aba desconhecida: ' + nome);
  }
}

// Colunas que precisam ficar como texto puro na planilha (formato "@"), para o
// Sheets não transformar "2026-11-10" em data nem "(64) 9..." em número.
function colunasTexto_(nome) {
  switch (nome) {
    case ABA_VENDAS: return ['id', 'cliente_telefone', 'cliente_cpf', 'primeiro_vencimento', 'criado_em', 'atualizado_em'];
    case ABA_PARCELAS: return ['id', 'venda_id', 'vencimento', 'data_pagamento', 'criado_em', 'atualizado_em'];
    case ABA_USUARIOS: return ['usuario', 'senha_hash'];
    case ABA_LOG: return ['data_hora', 'registro_id'];
    case ABA_PAGAMENTOS: return ['id', 'primeiro_vencimento', 'documento', 'criado_em', 'atualizado_em'];
    case ABA_EMPRESTIMOS: return ['id', 'devedor_telefone', 'devedor_cpf', 'data_emprestimo', 'primeiro_vencimento', 'criado_em', 'atualizado_em'];
    default: return [];
  }
}

function aba_(nome) {
  var ss = planilha_();
  var aba = ss.getSheetByName(nome);
  // As abas de pagamentos e empréstimos vieram depois da instalação: são criadas
  // sozinhas no primeiro uso, sem precisar rodar nada no editor.
  if (!aba && (nome === ABA_PAGAMENTOS || nome === ABA_EMPRESTIMOS)) {
    try { aba = criarAbaDb_(ss, nome); } catch (e) { aba = ss.getSheetByName(nome); } // outra pessoa criou ao mesmo tempo
  }
  if (!aba) falha_('A aba ' + nome + ' não existe. Rode setupDatabase() no editor do Apps Script.');
  return aba;
}

/**
 * Lê a aba inteira e devolve um objeto por linha, com as chaves do cabeçalho
 * e `_linha` (número da linha na planilha). Linhas sem id são ignoradas.
 */
function lerTabela_(nome) {
  var valores = aba_(nome).getDataRange().getValues();
  if (valores.length < 2) return [];
  var cabecalho = valores[0].map(function (c) { return texto_(c); });
  var chave = cabecalho[0];
  var linhas = [];
  for (var i = 1; i < valores.length; i++) {
    var linha = valores[i];
    if (texto_(linha[0]) === '' && chave !== 'data_hora') continue;
    var obj = { _linha: i + 1 };
    for (var c = 0; c < cabecalho.length; c++) {
      if (cabecalho[c]) obj[cabecalho[c]] = valores[i][c];
    }
    linhas.push(obj);
  }
  return linhas;
}

function indiceColunas_(aba) {
  var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
  var idx = {};
  cab.forEach(function (c, i) { if (texto_(c)) idx[texto_(c)] = i; });
  return { nomes: cab.map(function (c) { return texto_(c); }), indice: idx };
}

/** Monta a linha na ordem do cabeçalho da aba. Campos ausentes viram ''. */
function montarLinha_(nomes, obj) {
  return nomes.map(function (campo) {
    var v = obj[campo];
    return v == null ? '' : v;
  });
}

function inserirLinha_(nome, obj) {
  var aba = aba_(nome);
  var cols = indiceColunas_(aba);
  var linha = aba.getLastRow() + 1;
  aba.getRange(linha, 1, 1, cols.nomes.length).setValues([montarLinha_(cols.nomes, obj)]);
  return linha;
}

/** Insere várias linhas de uma vez (uma única escrita). */
function inserirLinhas_(nome, objetos) {
  if (!objetos.length) return;
  var aba = aba_(nome);
  var cols = indiceColunas_(aba);
  var inicio = aba.getLastRow() + 1;
  var matriz = objetos.map(function (o) { return montarLinha_(cols.nomes, o); });
  aba.getRange(inicio, 1, matriz.length, cols.nomes.length).setValues(matriz);
}

/** Atualiza só os campos informados em `obj`, na linha indicada. */
function atualizarLinha_(nome, linha, obj) {
  var aba = aba_(nome);
  var cols = indiceColunas_(aba);
  var atual = aba.getRange(linha, 1, 1, cols.nomes.length).getValues()[0];
  cols.nomes.forEach(function (campo, i) {
    if (Object.prototype.hasOwnProperty.call(obj, campo)) {
      atual[i] = obj[campo] == null ? '' : obj[campo];
    }
  });
  aba.getRange(linha, 1, 1, cols.nomes.length).setValues([atual]);
}

/** Próximo id sequencial: prefixo + número com zeros à esquerda (V0001, P00001). */
function proximoId_(prefixo, digitos, registros) {
  var maior = 0;
  registros.forEach(function (r) {
    var m = String(r.id || '').match(new RegExp('^' + prefixo + '(\\d+)$'));
    if (m) maior = Math.max(maior, Number(m[1]));
  });
  var n = String(maior + 1);
  while (n.length < digitos) n = '0' + n;
  return prefixo + n;
}

function registrarLog_(usuario, acao, entidade, registroId, resumo) {
  inserirLinha_(ABA_LOG, {
    data_hora: agoraTexto_(),
    usuario: usuario && usuario.nome ? usuario.nome : String(usuario || 'sistema'),
    acao: acao,
    entidade: entidade,
    registro_id: registroId,
    resumo_alteracao: texto_(resumo, 500)
  });
}

function acaoListLog(dados) {
  var limite = Math.min(inteiro_(dados.limite) || 500, 2000);
  var linhas = lerTabela_(ABA_LOG).map(function (l) {
    return {
      data_hora: texto_(l.data_hora),
      usuario: texto_(l.usuario),
      acao: texto_(l.acao),
      entidade: texto_(l.entidade),
      registro_id: texto_(l.registro_id),
      resumo_alteracao: texto_(l.resumo_alteracao)
    };
  });
  return linhas.slice(-limite).reverse();
}

// ───────────── Conversão das linhas cruas em registros tipados ─────────────

function vendaDaLinha_(l) {
  return {
    id: texto_(l.id),
    cliente_nome: texto_(l.cliente_nome),
    cliente_telefone: texto_(l.cliente_telefone),
    cliente_cpf: texto_(l.cliente_cpf),
    imovel: texto_(l.imovel),
    valor_imovel: numero_(l.valor_imovel),
    tipo_condicao: texto_(l.tipo_condicao),
    valor_entrada: numero_(l.valor_entrada) || 0,
    num_parcelas: inteiro_(l.num_parcelas) || 1,
    primeiro_vencimento: dataIso_(l.primeiro_vencimento),
    periodicidade: texto_(l.periodicidade) || 'Mensal',
    corretor: texto_(l.corretor),
    observacoes: texto_(l.observacoes),
    ativo: booleano_(l.ativo),
    criado_em: texto_(l.criado_em),
    criado_por: texto_(l.criado_por),
    atualizado_em: texto_(l.atualizado_em),
    atualizado_por: texto_(l.atualizado_por),
    _linha: l._linha
  };
}

function parcelaDaLinha_(l) {
  return {
    id: texto_(l.id),
    venda_id: texto_(l.venda_id),
    numero: inteiro_(l.numero) || 0,
    valor: numero_(l.valor) || 0,
    vencimento: dataIso_(l.vencimento),
    status: texto_(l.status) === 'Pago' ? 'Pago' : 'A pagar',
    data_pagamento: dataIso_(l.data_pagamento),
    valor_pago: numero_(l.valor_pago),
    forma_pagamento: texto_(l.forma_pagamento),
    observacoes: texto_(l.observacoes),
    ativo: booleano_(l.ativo),
    criado_em: texto_(l.criado_em),
    criado_por: texto_(l.criado_por),
    atualizado_em: texto_(l.atualizado_em),
    atualizado_por: texto_(l.atualizado_por),
    _linha: l._linha
  };
}

function lerVendas_(incluirInativas) {
  return lerTabela_(ABA_VENDAS).map(vendaDaLinha_)
    .filter(function (v) { return v.id && (incluirInativas || v.ativo); });
}

function lerParcelas_(incluirInativas) {
  return lerTabela_(ABA_PARCELAS).map(parcelaDaLinha_)
    .filter(function (p) { return p.id && (incluirInativas || p.ativo); });
}

/** Remove os campos internos antes de devolver ao site. */
function publico_(obj) {
  var copia = {};
  Object.keys(obj).forEach(function (k) { if (k.charAt(0) !== '_') copia[k] = obj[k]; });
  return copia;
}
