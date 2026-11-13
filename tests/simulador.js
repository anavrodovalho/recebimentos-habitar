'use strict';
/**
 * Simulador mínimo do ambiente Apps Script (SpreadsheetApp, Utilities,
 * CacheService, LockService, ContentService) para rodar os arquivos .gs em Node.
 * Uso: const { criarAmbiente } = require('./simulador');
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.rows[this.r - 1 + i] || [];
      out.push(Array.from({ length: this.nc }, (_, j) => (row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j])));
    }
    return out;
  }
  setValues(matriz) {
    if (matriz.length !== this.nr || matriz.some((l) => l.length !== this.nc)) throw new Error('setValues: dimensões erradas');
    for (let i = 0; i < this.nr; i++) {
      const idx = this.r - 1 + i;
      while (this.sheet.rows.length <= idx) this.sheet.rows.push([]);
      for (let j = 0; j < this.nc; j++) this.sheet.rows[idx][this.c - 1 + j] = coerce(this.sheet, this.c + j, matriz[i][j]);
    }
    this.sheet.maxRows = Math.max(this.sheet.maxRows, this.sheet.rows.length);
    return this;
  }
  setNumberFormat(f) { for (let j = 0; j < this.nc; j++) this.sheet.formatos[this.c + j] = f; return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

// Imita o Sheets: uma célula sem formato "@" converte texto "2026-11-10" em Date
// e "123" em número. É assim que pegamos esquecimentos de formato nos testes.
function coerce(sheet, col, v) {
  if (sheet.formatos[col] === '@') return v == null ? '' : String(v);
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T03:00:00Z');
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  }
  return v;
}

class Sheet {
  constructor(name, rows) {
    this.name = name; this.rows = rows || []; this.formatos = {}; this.frozen = 0;
    this.maxRows = Math.max(1000, this.rows.length); this.maxCols = 26;
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getLastRow() { let last = 0; this.rows.forEach((row, i) => { if (row.some((v) => v !== '' && v != null)) last = i + 1; }); return last; }
  getLastColumn() { return this.rows.reduce((m, row) => Math.max(m, row.length), 0); }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  deleteColumns(from, n) { this.maxCols -= n; return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
}

class Spreadsheet {
  constructor() { this.sheets = []; this.active = null; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  setActiveSheet(s) { this.active = s; return s; }
  moveActiveSheet(pos) { const i = this.sheets.indexOf(this.active); this.sheets.splice(i, 1); this.sheets.splice(pos - 1, 0, this.active); }
  getSpreadsheetTimeZone() { return 'America/Sao_Paulo'; }
  getSheets() { return this.sheets; }
}

function formatDate(date, tz, fmt) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const h = partes.hour === '24' ? '00' : partes.hour;
  if (fmt === 'yyyy-MM-dd') return `${partes.year}-${partes.month}-${partes.day}`;
  if (fmt === 'yyyy-MM-dd HH:mm:ss') return `${partes.year}-${partes.month}-${partes.day} ${h}:${partes.minute}:${partes.second}`;
  throw new Error('formato não simulado: ' + fmt);
}

function criarAmbiente(opcoes = {}) {
  const ss = new Spreadsheet();
  (opcoes.abas || []).forEach(({ nome, linhas }) => ss.sheets.push(new Sheet(nome, linhas)));
  const cache = new Map();
  let agoraFixo = opcoes.agora ? Date.parse(opcoes.agora) : null;
  const RealDate = Date;
  class DateSim extends RealDate {
    constructor(...a) { if (a.length === 0 && agoraFixo) super(agoraFixo); else super(...a); }
    static now() { return agoraFixo || RealDate.now(); }
  }
  const sandbox = {
    console, Date: DateSim,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ss,
      getUi: () => { throw new Error('sem UI no simulador'); },
    },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, texto) => Array.from(crypto.createHash('sha256').update(texto, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const e = cache.get(k); if (!e) return null; if (e.exp < DateSim.now()) { cache.delete(k); return null; } return e.v; },
        put: (k, v, s) => { cache.set(k, { v: String(v), exp: DateSim.now() + (s || 600) * 1000 }); },
        remove: (k) => cache.delete(k),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } }),
    },
    Logger: { log: (...a) => (opcoes.silencioso ? null : console.log('[Logger]', ...a)) },
  };
  vm.createContext(sandbox);
  const dir = path.join(__dirname, '..', 'apps-script');
  ['Code.gs', 'Auth.gs', 'Db.gs', 'Parcelas.gs', 'Vendas.gs', 'Contratos.gs', 'Setup.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
  });
  return {
    ss, sandbox,
    setAgora(iso) { agoraFixo = Date.parse(iso); },
    chamar(action, payload, token) {
      const saida = sandbox.doPost({ postData: { contents: JSON.stringify({ action, token, payload }) } });
      return JSON.parse(saida.getContent());
    },
    // JSON de ida e volta: objetos criados dentro do vm têm outro protótipo e quebram o deepStrictEqual.
    rodar(nome, ...args) { const r = sandbox[nome](...args); return r === undefined ? r : JSON.parse(JSON.stringify(r)); },
  };
}

/** Abas no layout antigo da planilha (título, instrução, cabeçalho na linha 3), com os exemplos reais. */
function abasAntigas() {
  const d = (s) => { const [dd, mm, yy] = s.split('/'); return new Date(`${yy}-${mm}-${dd}T03:00:00Z`); };
  const vendasCab = ['ID da venda', 'Nome do cliente', 'Telefone / WhatsApp', 'Imóvel comprado', 'Valor do imóvel', 'Tipo de condição',
    'Valor a receber (entrada)', 'Condições de pagamento (nº de parcelas)', 'Valor da parcela', 'Data de vencimento (1ª parcela)', 'Corretor(a)',
    'Total recebido', 'Saldo a receber', 'Parcelas pagas', 'Próximo vencimento', 'Situação', 'Conferência', 'Observações'];
  const parcelasCab = ['ID da venda', 'Nome do cliente', 'Imóvel comprado', 'Nº da parcela', 'Parcela', 'Valor', 'Data de vencimento', 'Status',
    'Data do pagamento', 'Forma de pagamento', 'Dias em atraso', 'Situação', 'Observações'];
  const p = (id, cli, im, n, tot, val, venc, st, pg, forma) => [id, cli, im, n, `${n}/${tot}`, val, d(venc), st, pg ? d(pg) : '', forma || '', '', '', ''];
  return [
    { nome: 'Resumo', linhas: [['', 'HABITAR IMÓVEIS'], ['', 'Controle de recebimentos a prazo']] },
    { nome: 'Vendas', linhas: [
      ['Vendas com entrada a prazo / parcelada'], ['Um registro por venda.'], vendasCab,
      ['V001', 'Cliente Exemplo 1', '(64) 99999-0001', 'Apto 204 – Ed. Exemplo', 280000, 'Entrada parcelada', 30000, 6, 5000, d('10/09/2026'), 'Ana Laura', 10000, 20000, '2/6', d('10/11/2026'), 'Em atraso', 'OK', 'EXEMPLO – apagar'],
      ['V002', 'Cliente Exemplo 2', '(64) 99999-0002', 'Casa – Qd. 12 Lt. 08, Bairro Exemplo', 420000, 'Entrada a prazo', 45000, 1, 45000, d('18/11/2026'), 'Ana Laura', 0, 45000, '0/1', d('18/11/2026'), 'Em dia', 'OK', 'EXEMPLO – apagar'],
      ['V003', 'Cliente Exemplo 3', '(64) 99999-0003', 'Lote – Residencial Exemplo', 95000, 'Entrada parcelada', 12000, 3, 4000, d('05/08/2026'), 'Ana Laura', 12000, 0, '3/3', '—', 'Quitado', 'OK', 'EXEMPLO – apagar'],
      ['', '', '', '', '', '', '', '', '', '', '', 0, 0, '', '', '', '', ''],
    ] },
    { nome: 'Parcelas', linhas: [
      ['Parcelas e vencimentos'], ['Uma linha por parcela.'], parcelasCab,
      p('V001', 'Cliente Exemplo 1', 'Apto 204 – Ed. Exemplo', 1, 6, 5000, '10/09/2026', 'Pago', '10/09/2026', 'PIX'),
      p('V001', 'Cliente Exemplo 1', 'Apto 204 – Ed. Exemplo', 2, 6, 5000, '10/10/2026', 'Pago', '10/10/2026', 'PIX'),
      p('V001', 'Cliente Exemplo 1', 'Apto 204 – Ed. Exemplo', 3, 6, 5000, '10/11/2026', 'A pagar'),
      p('V001', 'Cliente Exemplo 1', 'Apto 204 – Ed. Exemplo', 4, 6, 5000, '10/12/2026', 'A pagar'),
      p('V001', 'Cliente Exemplo 1', 'Apto 204 – Ed. Exemplo', 5, 6, 5000, '10/01/2027', 'A pagar'),
      p('V001', 'Cliente Exemplo 1', 'Apto 204 – Ed. Exemplo', 6, 6, 5000, '10/02/2027', 'A pagar'),
      p('V002', 'Cliente Exemplo 2', 'Casa – Qd. 12 Lt. 08, Bairro Exemplo', 1, 1, 45000, '18/11/2026', 'A pagar'),
      p('V003', 'Cliente Exemplo 3', 'Lote – Residencial Exemplo', 1, 3, 4000, '05/08/2026', 'Pago', '05/08/2026', 'Boleto'),
      p('V003', 'Cliente Exemplo 3', 'Lote – Residencial Exemplo', 2, 3, 4000, '05/09/2026', 'Pago', '05/09/2026', 'Boleto'),
      p('V003', 'Cliente Exemplo 3', 'Lote – Residencial Exemplo', 3, 3, 4000, '05/10/2026', 'Pago', '05/10/2026', 'Boleto'),
      ['', '', '', '', '', '', '', '', '', '', '', '', ''],
    ] },
    { nome: 'Como usar', linhas: [['', 'Como usar a planilha']] },
  ];
}

module.exports = { criarAmbiente, abasAntigas };
