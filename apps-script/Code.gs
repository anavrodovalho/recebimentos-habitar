/**
 * Controle de Recebimentos a Prazo — Habitar Imóveis
 * API JSON (Apps Script) sobre a planilha Controle_Recebimentos_Habitar.
 *
 * Regras de ouro:
 *  - A planilha é só o banco de dados. Ninguém edita nela direto.
 *  - As abas db_* têm o cabeçalho na linha 1 e nenhuma fórmula.
 *  - Datas são gravadas como texto yyyy-mm-dd; valores como número.
 *  - Todo cálculo (saldo, situação, atraso) acontece aqui, nunca na planilha.
 *
 * Arquivos: Code.gs (roteamento) · Auth.gs (login) · Db.gs (leitura/escrita)
 *           Vendas.gs · Parcelas.gs · Contratos.gs (pagamentos e empréstimos) · Setup.gs (instalação)
 */

// Deixe vazio quando o script estiver vinculado à planilha (Extensões → Apps Script).
// Só preencha se o script for um projeto separado da planilha.
var SPREADSHEET_ID = '';

var FUSO = 'America/Sao_Paulo';

var ABA_VENDAS = 'db_vendas';
var ABA_PARCELAS = 'db_parcelas';
var ABA_USUARIOS = 'db_usuarios';
var ABA_LOG = 'db_log';
var ABA_PAGAMENTOS = 'db_pagamentos';   // contas que a Habitar tem a pagar
var ABA_EMPRESTIMOS = 'db_emprestimos'; // valores emprestados a receber

var SESSAO_HORAS = 12;
var CACHE_MAX_SEGUNDOS = 21600;   // limite do CacheService: 6 horas por gravação
var MAX_TENTATIVAS_LOGIN = 5;
var BLOQUEIO_LOGIN_SEGUNDOS = 900; // 15 minutos
var ESPERA_LOCK_MS = 20000;

var DIAS_ALERTA_VENCIMENTO = 7;

var TIPOS_CONDICAO = ['Entrada a prazo', 'Entrada parcelada', 'Outro'];
var PERIODICIDADES = ['Mensal', 'Quinzenal', 'Personalizada'];
var FORMAS_PAGAMENTO = ['PIX', 'Boleto', 'Transferência', 'Dinheiro', 'Cheque', 'Cartão'];
var STATUS_PARCELA = ['A pagar', 'Pago'];

// ───────────────────────────── Entrada da API ─────────────────────────────

// escrita: true → roda dentro do LockService (duas pessoas podem salvar ao mesmo tempo).
// É uma função (e não um objeto global) para não depender da ordem em que o
// Apps Script carrega os arquivos .gs.
function acoes_() {
  return {
    getDashboard:    { fn: acaoGetDashboard },
    listVendas:      { fn: acaoListVendas },
    getVenda:        { fn: acaoGetVenda },
    saveVenda:       { fn: acaoSaveVenda, escrita: true },
    deleteVenda:     { fn: acaoDeleteVenda, escrita: true },
    listParcelas:    { fn: acaoListParcelas },
    saveParcela:     { fn: acaoSaveParcela, escrita: true },
    baixarParcela:   { fn: acaoBaixarParcela, escrita: true },
    estornarParcela: { fn: acaoEstornarParcela, escrita: true },
    deleteParcela:   { fn: acaoDeleteParcela, escrita: true },
    listLog:         { fn: acaoListLog },
    // Pagamentos e empréstimos: payload.tipo = 'pagamento' | 'emprestimo'
    listContratos:   { fn: acaoListContratos },
    getContrato:     { fn: acaoGetContrato },
    saveContrato:    { fn: acaoSaveContrato, escrita: true },
    deleteContrato:  { fn: acaoDeleteContrato, escrita: true }
  };
}

function doGet() {
  return respostaJson_({ ok: true, sistema: 'Recebimentos Habitar' });
}

function doPost(e) {
  var resposta;
  try {
    var pedido = JSON.parse(e.postData.contents);
    resposta = { ok: true, data: executar_(pedido), error: null };
  } catch (erro) {
    if (!erro.publico) console.error(erro);
    resposta = {
      ok: false,
      data: null,
      error: erro.publico ? erro.message : 'Erro no servidor. Tente de novo em instantes.',
      code: erro.code || null
    };
  }
  return respostaJson_(resposta);
}

function executar_(pedido) {
  var acao = pedido.action;
  var dados = pedido.payload || {};

  // Única ação sem token: o próprio login.
  if (acao === 'login') return acaoLogin(dados);

  var usuario = validarSessao_(pedido.token);
  if (acao === 'logout') return acaoLogout(pedido.token);

  var acoes = acoes_();
  var definicao = Object.prototype.hasOwnProperty.call(acoes, acao) ? acoes[acao] : null;
  if (!definicao) falha_('Ação desconhecida.');
  if (!definicao.escrita) return definicao.fn(dados, usuario);
  return comTrava_(function () { return definicao.fn(dados, usuario); });
}

function respostaJson_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Lança um erro cuja mensagem pode ser mostrada ao usuário. */
function falha_(mensagem, codigo) {
  var erro = new Error(mensagem);
  erro.publico = true;
  erro.code = codigo || null;
  throw erro;
}

function comTrava_(funcao) {
  var trava = LockService.getScriptLock();
  try {
    trava.waitLock(ESPERA_LOCK_MS);
  } catch (e) {
    falha_('O sistema está ocupado com outro registro. Tente de novo.');
  }
  try {
    return funcao();
  } finally {
    trava.releaseLock();
  }
}

function planilha_() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

// ───────────────────────────── Utilitários ─────────────────────────────

/** Texto limpo e limitado; devolve '' quando vazio. */
function texto_(valor, maximo) {
  var t = String(valor == null ? '' : valor).trim();
  return maximo ? t.slice(0, maximo) : t;
}

function normalizar_(valor) {
  return texto_(valor).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Converte para número (aceita "1.234,56"); devolve null quando não é número. */
function numero_(valor) {
  if (valor === '' || valor == null) return null;
  if (typeof valor === 'number') return isFinite(valor) ? valor : null;
  var t = String(valor).trim().replace(/R\$\s?/, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  var n = Number(t);
  return isFinite(n) ? n : null;
}

/** Arredonda para centavos evitando erro binário (ex.: 0.1 + 0.2). */
function centavos_(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

function inteiro_(valor) {
  var n = numero_(valor);
  return n !== null && Math.floor(n) === n ? n : null;
}

/**
 * Normaliza qualquer representação de data para texto yyyy-mm-dd.
 * Aceita Date, "yyyy-mm-dd", "dd/mm/yyyy" e "yyyy-mm-ddT..."; devolve '' se inválida.
 */
function dataIso_(valor) {
  if (valor == null || valor === '') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return isNaN(valor.getTime()) ? '' : Utilities.formatDate(valor, FUSO, 'yyyy-MM-dd');
  }
  var t = String(valor).trim();
  var m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    var br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!br) return '';
    m = [null, br[3], ('0' + br[2]).slice(-2), ('0' + br[1]).slice(-2)];
  }
  var ano = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
  var d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return '';
  return m[1] + '-' + m[2] + '-' + m[3];
}

function hojeIso_() {
  return Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd');
}

function agoraTexto_() {
  return Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd HH:mm:ss');
}

/** Dias inteiros entre duas datas yyyy-mm-dd (b − a). */
function diasEntre_(isoA, isoB) {
  return Math.round((Date.parse(isoB + 'T00:00:00Z') - Date.parse(isoA + 'T00:00:00Z')) / 86400000);
}

/** Soma meses a uma data yyyy-mm-dd mantendo o dia quando o mês permite (31/01 + 1 → 28/02). */
function somarMeses_(iso, meses) {
  var p = iso.split('-').map(Number);
  var alvo = new Date(Date.UTC(p[0], p[1] - 1 + meses, 1));
  var ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(p[2], ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

function somarDias_(iso, dias) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + dias * 86400000).toISOString().slice(0, 10);
}

function booleano_(valor) {
  if (valor === true || valor === false) return valor;
  var t = normalizar_(valor);
  return t === 'true' || t === 'sim' || t === '1' || t === 'verdadeiro';
}

/** Telefone com máscara (64) 99999-9999 a partir de qualquer formato; '' se vazio. */
function telefoneMascara_(valor) {
  var d = texto_(valor).replace(/\D/g, '');
  if (d.length === 13 && d.slice(0, 2) === '55') d = d.slice(2);
  if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return texto_(valor, 20);
}
