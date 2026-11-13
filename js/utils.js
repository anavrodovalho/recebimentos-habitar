'use strict';
/**
 * utils.js — formatação brasileira, datas no fuso de São Paulo e ajudantes de DOM.
 */

const FUSO = 'America/Sao_Paulo';
const FORMAS_PAGAMENTO = ['PIX', 'Boleto', 'Transferência', 'Dinheiro', 'Cheque', 'Cartão'];
const TIPOS_CONDICAO = ['Entrada a prazo', 'Entrada parcelada', 'Outro'];
const PERIODICIDADES = ['Mensal', 'Quinzenal', 'Personalizada'];

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMoedaCompacta = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

const el = (id) => document.getElementById(id);
const q = (sel, raiz = document) => raiz.querySelector(sel);
const qa = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

function esc(valor) {
  return String(valor == null ? '' : valor).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function semAcento(valor) {
  return String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function moeda(valor) {
  return fmtMoeda.format(Number(valor) || 0);
}

/** "R$ 50 mil" para rótulos curtos do gráfico. */
function moedaCurta(valor) {
  return 'R$ ' + fmtMoedaCompacta.format(Number(valor) || 0);
}

/** yyyy-mm-dd → dd/mm/aaaa. Devolve '—' para vazio. */
function dataBr(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

/** "2026-11-13 15:04:00" → "13/11/2026 15:04". */
function dataHoraBr(texto) {
  const m = String(texto || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : String(texto || '');
}

/** "2026-11" → "nov/26". */
function mesCurto(chave) {
  const [ano, mes] = chave.split('-').map(Number);
  const nome = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(ano, mes - 1, 1))).replace('.', '');
  return `${nome}/${String(ano).slice(2)}`;
}

function mesLongo(chave) {
  const [ano, mes] = chave.split('-').map(Number);
  const nome = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(ano, mes - 1, 1)));
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`;
}

function hojeIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
}

function diasEntre(isoA, isoB) {
  return Math.round((Date.parse(isoB + 'T00:00:00Z') - Date.parse(isoA + 'T00:00:00Z')) / 86400000);
}

function somarMeses(iso, meses) {
  const p = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(p[0], p[1] - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(p[2], ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

function somarDias(iso, dias) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + dias * 86400000).toISOString().slice(0, 10);
}

function dataValida(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function centavos(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

/** Lê um campo monetário digitado ("1.234,56", "1234.56", "R$ 1.234,56"). */
function lerMoeda(texto) {
  if (typeof texto === 'number') return texto;
  let t = String(texto || '').trim().replace(/R\$\s?/, '');
  if (!t) return null;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Valor numérico → texto para campos de edição ("1234,56"). */
function moedaCampo(valor) {
  if (valor == null || valor === '') return '';
  return Number(valor).toFixed(2).replace('.', ',');
}

function mascaraTelefone(valor) {
  let d = String(valor || '').replace(/\D/g, '').slice(0, 11);
  if (d.length > 10) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length > 6) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length > 2) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return d;
}

function mascaraCpf(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

/**
 * Link de cobrança no WhatsApp com mensagem educada já preenchida.
 * Usa o DDD + número do cliente; devolve '' se o telefone estiver incompleto.
 */
function linkWhatsApp(parcela) {
  const digitos = String(parcela.cliente_telefone || '').replace(/\D/g, '');
  if (digitos.length < 10) return '';
  const total = parcela.total_parcelas_venda || parcela.total_parcelas || '';
  const numero = total ? `${parcela.numero}/${total}` : String(parcela.numero);
  const primeiroNome = String(parcela.cliente_nome || '').trim().split(/\s+/)[0] || '';
  const vencida = parcela.situacao === 'Atrasado';
  const texto = `Olá, ${primeiroNome}! Tudo bem? Aqui é da Habitar Imóveis. ` +
    (vencida
      ? `Passando para lembrar que a parcela ${numero} da entrada do imóvel ${parcela.imovel}, no valor de ${moeda(parcela.valor)}, venceu em ${dataBr(parcela.vencimento)}. `
      : `Passando para lembrar da parcela ${numero} da entrada do imóvel ${parcela.imovel}, no valor de ${moeda(parcela.valor)}, com vencimento em ${dataBr(parcela.vencimento)}. `) +
    'Se já tiver feito o pagamento, pode desconsiderar. Qualquer dúvida, estamos à disposição!';
  return `https://wa.me/55${digitos}?text=${encodeURIComponent(texto)}`;
}

/** Baixa um CSV (separador ; e BOM, para abrir direto no Excel em português). */
function exportarCsv(nomeArquivo, colunas, linhas) {
  const celula = (v) => {
    const t = String(v == null ? '' : v);
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const conteudo = [colunas.map((c) => celula(c.rotulo)).join(';')]
    .concat(linhas.map((l) => colunas.map((c) => celula(c.valor(l))).join(';')))
    .join('\r\n');
  const blob = new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${nomeArquivo}-${hojeIso()}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function opcoesSelect(lista, selecionado, vazio) {
  const inicio = vazio != null ? `<option value="">${esc(vazio)}</option>` : '';
  return inicio + lista.map((item) => {
    const valor = typeof item === 'string' ? item : item.valor;
    const rotulo = typeof item === 'string' ? item : item.rotulo;
    return `<option value="${esc(valor)}"${valor === selecionado ? ' selected' : ''}>${esc(rotulo)}</option>`;
  }).join('');
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Classe CSS da pílula de situação (parcela ou venda). */
function classeSituacao(situacao) {
  return {
    'Atrasado': 'st-atrasado', 'Em atraso': 'st-atrasado',
    'Vence em até 7 dias': 'st-breve',
    'Pago': 'st-pago', 'Quitada': 'st-pago',
    'A vencer': 'st-vencer', 'Em dia': 'st-vencer', 'A pagar': 'st-vencer',
    'Conferir': 'st-conferir',
  }[situacao] || 'st-neutro';
}

function pilula(situacao, texto) {
  return `<span class="pilula ${classeSituacao(situacao)}">${esc(texto || situacao)}</span>`;
}

function skeleton(linhas = 5, altura = 44) {
  return Array.from({ length: linhas }, () => `<div class="skeleton" style="height:${altura}px"></div>`).join('');
}
