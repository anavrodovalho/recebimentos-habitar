'use strict';
/**
 * dashboard.js — Painel.
 *  1. Cards de resumo (getDashboard)
 *  2. Gráfico previsto × recebido (12 meses) + "Atenção hoje" (getDashboard)
 *  3. Painéis complementares, calculados no navegador a partir de listVendas e listParcelas
 *     (os mesmos dados das telas Vendas e Parcelas; não exigem mudança no Apps Script):
 *     carteira em aberto por situação · progresso das vendas · recebido por forma de pagamento · saldo por corretor
 */

const painel = {
  async mostrar() {
    const raiz = el('vista-painel');
    if (!dados.dashboard) {
      raiz.innerHTML = `<div class="cards-resumo">${skeleton(6, 86).replace(/<div class="skeleton"/g, '<div class="skeleton" style="margin:0"')}</div>
        <div class="painel-grade"><div class="cartao">${skeleton(1, 260)}</div><div class="cartao">${skeleton(4, 64)}</div></div>`;
    }
    const d = await dados.carregarDashboard();
    this.render(d);
    this.carregarExtras();
  },

  render(d) {
    const c = d.cards;
    const raiz = el('vista-painel');
    raiz.innerHTML = `
      <div class="cards-resumo">
        ${card('Total a receber', moeda(c.total_a_receber), `${c.vendas_em_aberto} venda(s) em aberto`)}
        ${card('Total recebido', moeda(c.total_recebido), 'parcelas pagas', 'card-recebido')}
        ${card('Valor em atraso', moeda(c.valor_em_atraso), `${c.parcelas_atrasadas} parcela(s) atrasada(s)`, 'card-atraso')}
        ${card('A vencer em 30 dias', moeda(c.a_vencer_30_dias), `${c.parcelas_7_dias} vence(m) em até 7 dias`, 'card-breve')}
        ${card('Vendas em aberto', String(c.vendas_em_aberto), 'com saldo a receber')}
        ${card('Vendas quitadas', String(c.vendas_quitadas), 'entrada 100% recebida')}
      </div>
      <div class="painel-grade">
        <div class="cartao">
          <div class="cartao-titulo">
            <h2>Previsão de recebimentos</h2>
            <div class="legenda"><span class="leg-previsto">Previsto</span><span class="leg-recebido">Recebido</span></div>
          </div>
          <div id="grafico-previsao" class="grafico-caixa"></div>
          ${d.previsao.anteriores.previsto > 0 ? `<p class="nota">Meses anteriores: previsto ${moeda(d.previsao.anteriores.previsto)} · recebido ${moeda(d.previsao.anteriores.recebido)}.</p>` : ''}
        </div>
        <div class="cartao">
          <div class="cartao-titulo"><h2>Atenção hoje</h2><span class="filtros-ativos">${esc(dataBr(d.hoje))}</span></div>
          ${d.atencao.length ? `<div class="atencao-lista">${d.atencao.map(itemAtencao).join('')}</div>` : '<p class="vazio">Nenhuma parcela atrasada ou vencendo nos próximos 7 dias. 🎉</p>'}
        </div>
      </div>
      <div id="painel-extras" class="painel-extras">
        ${['Carteira em aberto', 'Progresso das vendas', 'Recebido por forma de pagamento', 'Saldo a receber por corretor']
          .map((t) => `<div class="cartao"><div class="cartao-titulo"><h2>${esc(t)}</h2></div>${skeleton(4, 28)}</div>`).join('')}
      </div>`;
    this.desenharGrafico();
    raiz.querySelectorAll('[data-baixa]').forEach((b) => b.addEventListener('click', () => {
      const p = d.atencao.find((x) => x.id === b.dataset.baixa);
      if (p) parcelas.abrirBaixa(p);
    }));
  },

  /** Desenha o gráfico na largura real da caixa (texto sempre no mesmo tamanho). */
  desenharGrafico() {
    const caixa = el('grafico-previsao');
    if (!caixa || !dados.dashboard) return;
    const meses = dados.dashboard.previsao.meses;
    caixa.innerHTML = graficoBarras(meses, caixa.clientWidth || 640);
    ligarTooltipGrafico(caixa, meses);
  },

  async carregarExtras() {
    const alvo = el('painel-extras');
    try {
      const [listaVendas, listaParcelas] = await Promise.all([dados.carregarVendas(), dados.carregarParcelas()]);
      if (!el('painel-extras') || app.rotaAtual !== 'painel') return;
      alvo.innerHTML = [
        painelCarteira(listaParcelas),
        painelProgresso(listaVendas),
        painelFormas(listaParcelas),
        painelCorretores(listaVendas),
      ].join('');
    } catch (erro) {
      if (alvo && erro.codigo !== 'SESSAO') alvo.innerHTML = `<div class="cartao"><p class="vazio">Não foi possível carregar os painéis complementares. ${esc(erro.message)}</p></div>`;
    }
  },
};

function card(rotulo, valor, sub, classe = '') {
  return `<div class="card-numero ${classe}"><span class="rotulo-card">${esc(rotulo)}</span><span class="valor-card">${esc(valor)}</span><span class="sub-card">${esc(sub)}</span></div>`;
}

function itemAtencao(p) {
  const atrasada = p.situacao === 'Atrasado';
  const whats = linkWhatsApp(p);
  const total = p.total_parcelas_venda ? `${p.numero}/${p.total_parcelas_venda}` : `${p.numero}`;
  return `
    <div class="atencao-item ${atrasada ? 'at-atrasado' : 'at-breve'}">
      <div>
        <strong>${esc(p.cliente_nome)}</strong>
        <small>${esc(p.imovel)} · parcela ${esc(total)}</small>
        <small style="margin-top:4px">${pilula(p.situacao, atrasada ? `Venceu ${dataBr(p.vencimento)} · ${p.dias_atraso} dia${p.dias_atraso === 1 ? '' : 's'} de atraso` : `Vence ${dataBr(p.vencimento)}`)}</small>
      </div>
      <div class="valor-item">${esc(moeda(p.valor))}</div>
      <div class="botoes-linha">
        <button class="botao botao-primario botao-pequeno" type="button" data-baixa="${esc(p.id)}">Dar baixa</button>
        ${whats ? `<a class="botao botao-whats botao-pequeno" href="${whats}" target="_blank" rel="noopener">Cobrar no WhatsApp</a>` : ''}
        <a class="botao botao-secundario botao-pequeno" href="#/vendas/${esc(p.venda_id)}">Ver venda</a>
      </div>
    </div>`;
}

// ───────────────────────────── Painéis complementares ─────────────────────────────

const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 100) : 0);

/** Carteira em aberto dividida por situação: barra 100% empilhada + legenda com valores. */
function painelCarteira(lista) {
  const abertas = lista.filter((p) => p.status !== 'Pago');
  const grupos = [
    { chave: 'Atrasado', rotulo: 'Em atraso', classe: 'seg-atrasado', icone: '!' },
    { chave: 'Vence em até 7 dias', rotulo: 'Vence em até 7 dias', classe: 'seg-breve', icone: '◷' },
    { chave: 'A vencer', rotulo: 'A vencer', classe: 'seg-vencer', icone: '✓' },
  ].map((g) => {
    const itens = abertas.filter((p) => p.situacao === g.chave);
    return Object.assign(g, { qtd: itens.length, valor: centavos(itens.reduce((s, p) => s + p.valor, 0)) });
  });
  const total = centavos(grupos.reduce((s, g) => s + g.valor, 0));
  if (!total) return cartaoExtra('Carteira em aberto', '<p class="vazio">Nenhuma parcela em aberto.</p>');
  const barra = grupos.filter((g) => g.valor > 0).map((g) =>
    `<span class="${g.classe}" style="flex:${g.valor}" title="${esc(g.rotulo)}: ${esc(moeda(g.valor))} (${pct(g.valor, total)}%)"></span>`).join('');
  const linhas = grupos.map((g) => `
    <li>
      <span class="marca ${g.classe}" aria-hidden="true">${g.icone}</span>
      <span class="rotulo-linha">${esc(g.rotulo)}<small>${g.qtd} parcela${g.qtd === 1 ? '' : 's'}</small></span>
      <span class="valor-linha">${esc(moeda(g.valor))}<small>${pct(g.valor, total)}%</small></span>
    </li>`).join('');
  return cartaoExtra('Carteira em aberto', `
    <p class="destaque-extra">${esc(moeda(total))}<small> em ${abertas.length} parcela${abertas.length === 1 ? '' : 's'}</small></p>
    <div class="barra-empilhada" role="img" aria-label="Carteira em aberto por situação">${barra}</div>
    <ul class="lista-extra">${linhas}</ul>`, '#/parcelas', 'Ver parcelas');
}

/** Progresso de cada venda em aberto: quanto da entrada já foi recebido. Maiores saldos primeiro. */
function painelProgresso(listaVendas) {
  const abertas = listaVendas.filter((v) => v.situacao !== 'Quitada')
    .sort((a, b) => (b.situacao === 'Em atraso') - (a.situacao === 'Em atraso') || b.saldo - a.saldo);
  if (!abertas.length) return cartaoExtra('Progresso das vendas', '<p class="vazio">Todas as vendas estão quitadas. 🎉</p>');
  const mostrar = abertas.slice(0, 6);
  const linhas = mostrar.map((v) => {
    const p = Math.min(100, pct(v.total_recebido, v.valor_entrada));
    return `
      <li class="progresso-item">
        <a href="#/vendas/${esc(v.id)}" class="progresso-nome">${esc(v.cliente_nome)}${v.situacao === 'Em atraso' ? ` ${pilula('Em atraso', 'Em atraso')}` : ''}</a>
        <span class="progresso-pct">${p}%</span>
        <div class="progresso progresso-fino" title="${esc(moeda(v.total_recebido))} de ${esc(moeda(v.valor_entrada))}"><span style="width:${p}%"></span></div>
        <small class="progresso-sub">${esc(moeda(v.total_recebido))} de ${esc(moeda(v.valor_entrada))} · ${v.parcelas_pagas}/${v.total_parcelas} parcelas</small>
      </li>`;
  }).join('');
  const resto = abertas.length - mostrar.length;
  return cartaoExtra('Progresso das vendas', `<ul class="lista-extra lista-progresso">${linhas}</ul>${resto > 0 ? `<p class="nota">+ ${resto} venda(s) em aberto.</p>` : ''}`, '#/vendas', 'Ver vendas');
}

/** Barras horizontais com rótulo e valor diretos (uma cor só: magnitude). */
function barrasHorizontais(itens, classe) {
  const maximo = Math.max(...itens.map((i) => i.valor), 1);
  return `<ul class="lista-extra lista-barras">${itens.map((i) => `
    <li title="${esc(i.rotulo)}: ${esc(moeda(i.valor))}">
      <span class="rotulo-linha">${esc(i.rotulo)}<small>${esc(i.sub)}</small></span>
      <span class="valor-linha">${esc(moeda(i.valor))}</span>
      <span class="trilho"><span class="${classe}" style="width:${Math.max(2, (i.valor / maximo) * 100)}%"></span></span>
    </li>`).join('')}</ul>`;
}

function painelFormas(lista) {
  const pagas = lista.filter((p) => p.status === 'Pago');
  if (!pagas.length) return cartaoExtra('Recebido por forma de pagamento', '<p class="vazio">Nenhum pagamento registrado ainda.</p>');
  const mapa = {};
  pagas.forEach((p) => {
    const f = p.forma_pagamento || 'Não informada';
    mapa[f] = mapa[f] || { valor: 0, qtd: 0 };
    mapa[f].valor += p.valor_pago != null ? p.valor_pago : p.valor;
    mapa[f].qtd += 1;
  });
  const itens = Object.keys(mapa).map((f) => ({ rotulo: f, valor: centavos(mapa[f].valor), sub: `${mapa[f].qtd} pagamento${mapa[f].qtd === 1 ? '' : 's'}` }))
    .sort((a, b) => b.valor - a.valor);
  const total = centavos(itens.reduce((s, i) => s + i.valor, 0));
  return cartaoExtra('Recebido por forma de pagamento',
    `<p class="destaque-extra">${esc(moeda(total))}<small> recebidos</small></p>${barrasHorizontais(itens, 'barra-recebido-h')}`);
}

function painelCorretores(listaVendas) {
  const abertas = listaVendas.filter((v) => v.saldo > 0);
  if (!abertas.length) return cartaoExtra('Saldo a receber por corretor', '<p class="vazio">Nenhum saldo a receber.</p>');
  const mapa = {};
  abertas.forEach((v) => {
    const c = v.corretor || 'Sem corretor';
    mapa[c] = mapa[c] || { valor: 0, qtd: 0, atraso: 0 };
    mapa[c].valor += v.saldo;
    mapa[c].qtd += 1;
    if (v.situacao === 'Em atraso') mapa[c].atraso += 1;
  });
  const itens = Object.keys(mapa).map((c) => ({
    rotulo: c, valor: centavos(mapa[c].valor),
    sub: `${mapa[c].qtd} venda${mapa[c].qtd === 1 ? '' : 's'}${mapa[c].atraso ? ` · ${mapa[c].atraso} em atraso` : ''}`,
  })).sort((a, b) => b.valor - a.valor).slice(0, 6);
  return cartaoExtra('Saldo a receber por corretor', barrasHorizontais(itens, 'barra-previsto-h'));
}

function cartaoExtra(titulo, corpo, link, rotuloLink) {
  return `<div class="cartao cartao-extra">
    <div class="cartao-titulo"><h2>${esc(titulo)}</h2>${link ? `<a href="${link}" class="link-pequeno">${esc(rotuloLink)} ›</a>` : ''}</div>
    ${corpo}
  </div>`;
}

// ───────────────────────────── Gráfico de previsão ─────────────────────────────

/**
 * Gráfico de barras agrupadas (SVG puro): previsto × recebido por mês.
 * Desenhado na largura real da caixa, para o texto não crescer em telas largas.
 * Um único eixo; rótulos diretos só nos meses com valor; tooltip no hover.
 */
function graficoBarras(meses, largura) {
  const L = Math.max(320, Math.round(largura));
  const estreito = L < 560;
  const A = estreito ? 230 : 280, mE = estreito ? 44 : 54, mD = 8, mT = 18, mB = 34;
  const larguraUtil = L - mE - mD, alturaUtil = A - mT - mB;
  const maximo = Math.max(1, ...meses.map((m) => Math.max(m.previsto, m.recebido)));
  const teto = escalaBonita(maximo);
  const grupo = larguraUtil / meses.length;
  const barra = Math.max(4, Math.min(22, (grupo - 12) / 2 - 1));
  const y = (v) => mT + alturaUtil - (v / teto) * alturaUtil;
  const linhas = [0, 0.25, 0.5, 0.75, 1];

  const grade = linhas.map((f) => {
    const yy = y(teto * f);
    return `<line x1="${mE}" x2="${L - mD}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/>
      <text x="${mE - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end">${esc(f === 0 ? '0' : moedaCurta(teto * f).replace('R$ ', ''))}</text>`;
  }).join('');

  const grupos = meses.map((m, i) => {
    const x0 = mE + i * grupo;
    const xc = x0 + grupo / 2;
    const xP = xc - barra - 1, xR = xc + 1;
    const hP = Math.max(0, mT + alturaUtil - y(m.previsto)), hR = Math.max(0, mT + alturaUtil - y(m.recebido));
    const rotulo = m.previsto > 0 && barra >= 12 ? `<text class="rotulo-valor" x="${xP + barra / 2}" y="${(y(m.previsto) - 5).toFixed(1)}" text-anchor="middle">${esc(moedaCurta(m.previsto).replace('R$ ', ''))}</text>` : '';
    return `<g class="grupo" data-indice="${i}">
      <rect class="barra-fundo" x="${x0}" y="${mT}" width="${grupo}" height="${alturaUtil}" rx="6"/>
      ${barraArredondada(xP, y(m.previsto), barra, hP, 'barra-previsto')}
      ${barraArredondada(xR, y(m.recebido), barra, hR, 'barra-recebido')}
      ${rotulo}
      ${!estreito || i % 2 === 0 ? `<text x="${xc}" y="${A - mB + 18}" text-anchor="middle">${esc(mesCurto(m.mes))}</text>` : ''}
    </g>`;
  }).join('');

  return `<svg class="grafico" viewBox="0 0 ${L} ${A}" width="${L}" height="${A}" role="img" aria-label="Previsão de recebimentos por mês, previsto e recebido">
    <g class="grade">${grade}</g>
    <g class="eixo"><line x1="${mE}" x2="${L - mD}" y1="${mT + alturaUtil}" y2="${mT + alturaUtil}"/></g>
    ${grupos}
  </svg>`;
}

/** Barra com topo arredondado (4 px) e base reta na linha zero. */
function barraArredondada(x, yTopo, largura, altura, classe) {
  if (altura <= 0) return '';
  const r = Math.min(4, altura, largura / 2);
  const x2 = x + largura, yBase = yTopo + altura;
  return `<path class="${classe}" d="M${x.toFixed(1)} ${yBase.toFixed(1)} V${(yTopo + r).toFixed(1)} Q${x.toFixed(1)} ${yTopo.toFixed(1)} ${(x + r).toFixed(1)} ${yTopo.toFixed(1)} H${(x2 - r).toFixed(1)} Q${x2.toFixed(1)} ${yTopo.toFixed(1)} ${x2.toFixed(1)} ${(yTopo + r).toFixed(1)} V${yBase.toFixed(1)} Z"/>`;
}

function escalaBonita(maximo) {
  const pot = Math.pow(10, Math.floor(Math.log10(maximo)));
  const base = maximo / pot;
  const passo = base <= 1 ? 1 : base <= 2 ? 2 : base <= 2.5 ? 2.5 : base <= 5 ? 5 : 10;
  return passo * pot;
}

function ligarTooltipGrafico(container, meses) {
  if (!container) return;
  let tip = null;
  const remover = () => { if (tip) { tip.remove(); tip = null; } };
  container.querySelectorAll('.grupo').forEach((g) => {
    const m = meses[Number(g.dataset.indice)];
    const mostrar = (e) => {
      if (!tip) { tip = document.createElement('div'); tip.className = 'tooltip-grafico'; document.body.appendChild(tip); }
      tip.innerHTML = `<strong>${esc(mesLongo(m.mes))}</strong>Previsto: ${esc(moeda(m.previsto))}<br>Recebido: ${esc(moeda(m.recebido))}`;
      const x = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = `${x}px`;
      tip.style.top = `${e.clientY + 12}px`;
    };
    g.addEventListener('mousemove', mostrar);
    g.addEventListener('touchstart', (e) => mostrar(e.touches[0]), { passive: true });
    g.addEventListener('mouseleave', remover);
  });
  container.addEventListener('touchend', () => setTimeout(remover, 1500), { passive: true });
}

// Redesenha o gráfico quando a largura muda (janela redimensionada ou celular girado).
let larguraGrafico = 0;
window.addEventListener('resize', debounce(() => {
  const caixa = el('grafico-previsao');
  if (!caixa || app.rotaAtual !== 'painel') return;
  if (Math.abs(caixa.clientWidth - larguraGrafico) < 8) return;
  larguraGrafico = caixa.clientWidth;
  painel.desenharGrafico();
}, 150));
