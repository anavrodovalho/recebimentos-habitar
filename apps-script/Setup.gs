/**
 * Setup.gs — instalação do banco (rodar uma única vez) e gestão de usuários.
 *
 * No editor do Apps Script:
 *   1. Selecione `setupDatabase` e clique em Executar. Autorize quando pedir.
 *   2. Cadastre os usuários pelo menu da planilha "Recebimentos Habitar →
 *      Criar ou redefinir usuário" (a senha é digitada numa caixa de diálogo e
 *      nunca passa pelo código), ou chame criarUsuario('ana', 'Ana Laura', 'senha')
 *      numa função temporária que você apaga depois de rodar.
 */

// true = as linhas de exemplo da planilha (V001–V003 / "Cliente Exemplo") também
// são migradas, para servirem de teste. Depois dá para excluí-las pelo sistema.
var MIGRAR_EXEMPLOS = true;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Recebimentos Habitar')
    .addItem('Criar ou redefinir usuário', 'menuCriarUsuario')
    .addItem('Desativar usuário', 'menuDesativarUsuario')
    .addSeparator()
    .addItem('Configurar banco de dados (uma vez)', 'setupDatabase')
    .addToUi();
}

/**
 * Cria as abas db_* (cabeçalho na linha 1, sem fórmulas), migra os dados das
 * abas Vendas e Parcelas e renomeia as abas antigas para backup_*.
 */
function setupDatabase() {
  var ss = planilha_();
  if (ss.getSheetByName(ABA_VENDAS)) {
    throw new Error('O banco já foi configurado: a aba ' + ABA_VENDAS + ' existe. Nada foi alterado.');
  }

  [ABA_VENDAS, ABA_PARCELAS, ABA_USUARIOS, ABA_LOG].forEach(function (nome) { criarAbaDb_(ss, nome); });

  var migracao = migrarDadosAntigos_(ss);

  renomearSeExistir_(ss, 'Vendas', 'backup_Vendas');
  renomearSeExistir_(ss, 'Parcelas', 'backup_Parcelas');
  renomearSeExistir_(ss, 'Resumo', 'backup_Resumo');

  // Deixa as abas do banco na frente.
  [ABA_LOG, ABA_USUARIOS, ABA_PARCELAS, ABA_VENDAS].forEach(function (nome) {
    ss.setActiveSheet(ss.getSheetByName(nome));
    ss.moveActiveSheet(1);
  });

  registrarLog_('sistema', 'setup', 'banco', '', 'Banco criado. Migradas ' + migracao.vendas +
    ' venda(s) e ' + migracao.parcelas + ' parcela(s); ' + migracao.ignoradas + ' linha(s) de exemplo ignoradas.');
  var msg = 'Banco configurado. Vendas migradas: ' + migracao.vendas + ' · Parcelas: ' + migracao.parcelas +
    ' · Exemplos ignorados: ' + migracao.ignoradas + '. Agora cadastre os usuários.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* rodando pelo editor, sem interface */ }
  return msg;
}

function criarAbaDb_(ss, nome) {
  var aba = ss.insertSheet(nome);
  var cab = cabecalhos_(nome);
  aba.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#0D2040').setFontColor('#FFFFFF');
  aba.setFrozenRows(1);
  // Colunas de texto puro: datas yyyy-mm-dd, telefones e ids não podem virar número/data.
  colunasTexto_(nome).forEach(function (campo) {
    var col = cab.indexOf(campo) + 1;
    if (col > 0) aba.getRange(1, col, aba.getMaxRows(), 1).setNumberFormat('@');
  });
  if (aba.getMaxColumns() > cab.length) aba.deleteColumns(cab.length + 1, aba.getMaxColumns() - cab.length);
  return aba;
}

function renomearSeExistir_(ss, de, para) {
  var aba = ss.getSheetByName(de);
  if (aba && !ss.getSheetByName(para)) aba.setName(para);
}

/** Lê uma aba antiga (título nas linhas 1–2, cabeçalho na linha 3) como objetos por cabeçalho. */
function lerAbaAntiga_(ss, nome) {
  var aba = ss.getSheetByName(nome);
  if (!aba) return [];
  var valores = aba.getDataRange().getValues();
  var linhaCab = -1;
  for (var i = 0; i < Math.min(valores.length, 10); i++) {
    if (texto_(valores[i][0]) === 'ID da venda') { linhaCab = i; break; }
  }
  if (linhaCab < 0) return [];
  var cab = valores[linhaCab].map(function (c) { return texto_(c); });
  var linhas = [];
  for (var r = linhaCab + 1; r < valores.length; r++) {
    if (!texto_(valores[r][0])) continue;
    var obj = {};
    cab.forEach(function (c, i) { if (c) obj[c] = valores[r][i]; });
    linhas.push(obj);
  }
  return linhas;
}

function ehExemplo_(id, nome) {
  return /^V00[123]$/.test(texto_(id)) || /cliente exemplo/i.test(texto_(nome));
}

function migrarDadosAntigos_(ss) {
  var agora = agoraTexto_();
  var vendasAntigas = lerAbaAntiga_(ss, 'Vendas');
  var parcelasAntigas = lerAbaAntiga_(ss, 'Parcelas');
  var mapaIds = {};
  var vendas = [];
  var ignoradas = 0;

  vendasAntigas.forEach(function (l) {
    var idAntigo = texto_(l['ID da venda']);
    var nome = texto_(l['Nome do cliente']);
    if (!MIGRAR_EXEMPLOS && ehExemplo_(idAntigo, nome)) { ignoradas++; return; }
    var m = idAntigo.match(/(\d+)$/);
    var novoId = m ? 'V' + ('0000' + m[1]).slice(-4) : proximoId_('V', 4, vendas);
    if (mapaIds[idAntigo] || vendas.some(function (v) { return v.id === novoId; })) novoId = proximoId_('V', 4, vendas);
    mapaIds[idAntigo] = novoId;
    var tipo = texto_(l['Tipo de condição']);
    var nParc = inteiro_(l['Condições de pagamento (nº de parcelas)']) || 1;
    vendas.push({
      id: novoId,
      cliente_nome: nome,
      cliente_telefone: telefoneMascara_(l['Telefone / WhatsApp']),
      cliente_cpf: '',
      imovel: texto_(l['Imóvel comprado']),
      valor_imovel: numero_(l['Valor do imóvel']),
      tipo_condicao: TIPOS_CONDICAO.indexOf(tipo) >= 0 ? tipo : (nParc > 1 ? 'Entrada parcelada' : 'Entrada a prazo'),
      valor_entrada: numero_(l['Valor a receber (entrada)']) || 0,
      num_parcelas: nParc,
      primeiro_vencimento: dataIso_(l['Data de vencimento (1ª parcela)']),
      periodicidade: 'Mensal',
      corretor: texto_(l['Corretor(a)']),
      observacoes: texto_(l['Observações']),
      ativo: true,
      criado_em: agora, criado_por: 'migração', atualizado_em: agora, atualizado_por: 'migração'
    });
  });

  var parcelas = [];
  var seq = 1;
  parcelasAntigas.forEach(function (l) {
    var vendaId = mapaIds[texto_(l['ID da venda'])];
    if (!vendaId) { ignoradas++; return; }
    var valor = numero_(l['Valor']) || 0;
    var pago = texto_(l['Status']) === 'Pago';
    parcelas.push({
      id: 'P' + ('00000' + seq++).slice(-5),
      venda_id: vendaId,
      numero: inteiro_(l['Nº da parcela']) || parcelas.filter(function (p) { return p.venda_id === vendaId; }).length + 1,
      valor: valor,
      vencimento: dataIso_(l['Data de vencimento']),
      status: pago ? 'Pago' : 'A pagar',
      data_pagamento: pago ? dataIso_(l['Data do pagamento']) : '',
      valor_pago: pago ? valor : '',
      forma_pagamento: pago ? texto_(l['Forma de pagamento']) : '',
      observacoes: texto_(l['Observações']),
      ativo: true,
      criado_em: agora, criado_por: 'migração', atualizado_em: agora, atualizado_por: 'migração'
    });
  });

  inserirLinhas_(ABA_VENDAS, vendas);
  inserirLinhas_(ABA_PARCELAS, parcelas);
  return { vendas: vendas.length, parcelas: parcelas.length, ignoradas: ignoradas };
}

// ───────────────────────────── Usuários ─────────────────────────────

/**
 * Cria um usuário (perfil admin) ou redefine a senha de um existente.
 * A senha só é guardada como hash (salt + SHA-256).
 */
function criarUsuario(usuario, nome, senha) {
  usuario = normalizar_(usuario).replace(/\s+/g, '');
  nome = texto_(nome, 80);
  senha = String(senha == null ? '' : senha);
  if (!usuario || !nome) throw new Error('Informe o usuário (login) e o nome.');
  if (senha.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');

  var existente = buscarUsuario_(usuario);
  var registro = { usuario: usuario, nome: nome, senha_hash: gerarHash_(senha), perfil: 'admin', ativo: true };
  if (existente) {
    atualizarLinha_(ABA_USUARIOS, existente._linha, registro);
    registrarLog_('sistema', 'editar', 'usuario', usuario, 'Senha redefinida para ' + nome);
    Logger.log('Senha de "' + usuario + '" redefinida.');
    return 'Senha de "' + usuario + '" redefinida.';
  }
  inserirLinha_(ABA_USUARIOS, registro);
  registrarLog_('sistema', 'criar', 'usuario', usuario, 'Usuário criado: ' + nome);
  Logger.log('Usuário "' + usuario + '" criado.');
  return 'Usuário "' + usuario + '" criado.';
}

function desativarUsuario(usuario) {
  var existente = buscarUsuario_(usuario);
  if (!existente) throw new Error('Usuário não encontrado.');
  atualizarLinha_(ABA_USUARIOS, existente._linha, { ativo: false });
  registrarLog_('sistema', 'editar', 'usuario', existente.usuario, 'Usuário desativado');
  return 'Usuário "' + existente.usuario + '" desativado.';
}

function menuCriarUsuario() {
  var ui = SpreadsheetApp.getUi();
  var login = perguntar_(ui, 'Usuário (login, sem espaços). Ex.: ana');
  if (login === null) return;
  var nome = perguntar_(ui, 'Nome que aparece no sistema. Ex.: Ana Laura');
  if (nome === null) return;
  var senha = perguntar_(ui, 'Senha (mínimo 6 caracteres)');
  if (senha === null) return;
  try {
    ui.alert(criarUsuario(login, nome, senha));
  } catch (e) {
    ui.alert('Não foi possível: ' + e.message);
  }
}

function menuDesativarUsuario() {
  var ui = SpreadsheetApp.getUi();
  var login = perguntar_(ui, 'Usuário (login) a desativar');
  if (login === null) return;
  try {
    ui.alert(desativarUsuario(login));
  } catch (e) {
    ui.alert('Não foi possível: ' + e.message);
  }
}

function perguntar_(ui, pergunta) {
  var r = ui.prompt('Recebimentos Habitar', pergunta, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  return r.getResponseText();
}
