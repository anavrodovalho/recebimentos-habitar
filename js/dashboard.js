'use strict';
/**
 * dashboard.js — Painel: cards, gráfico previsto × recebido (12 meses) e "Atenção hoje".
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
          <div id="grafico-previsao">${graficoBarras(d.previsao.meses)}</div>
          ${d.previsao.anteriores.previsto > 0 ? `<p class="nota">Meses anteriores: previsto ${moeda(d.previsao.anteriores.previsto)} · recebido ${moeda(d.previsao.anteriores.recebido)}.</p>` : ''}
        </div>
        <div class="cartao">
          <div class="cartao-titulo"><h2>Atenção hoje</h2><span class="filtros-ativos">${esc(dataBr(d.hoje))}</span></div>
          ${d.atencao.length ? `<div class="atencao-lista">${d.atencao.map(itemAtencao).join('')}</div>` : '<p class="vazio">Nenhuma parcela atrasada ou vencendo nos próximos 7 dias. 🎉</p>'}
        </div>
      </div>`;
    ligarTooltipGrafico(raiz.querySelector('#grafico-previsao'), d.previsao.meses);
    raiz.querySelectorAll('[data-baixa]').forEach((b) => b.addEventListener('click', () => {
      const p = d.atencao.find((x) => x.id === b.dataset.baixa);
      if (p) parcelas.abrirBaixa(p);
    }));
  },
};

// Redesenha o gráfico quando a tela muda de faixa (ex.: girar o celular).
let graficoEstreito = window.innerWidth < 640;
window.addEventListener('resize', debounce(() => {
  const agora = window.innerWidth < 640;
  if (agora === graficoEstreito || app.rotaAtual !== 'painel' || !dados.dashboard) return;
  graficoEstreito = agora;
  painel.render(dados.dashboard);
}, 200));

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

/**
 * Gráfico de barras agrupadas (SVG puro, sem biblioteca): previsto × recebido por mês.
 * Um único eixo; rótulos diretos só nos meses com valor; tooltip no hover.
 */
function graficoBarras(meses) {
  // Em telas estreitas o desenho é menor e só metade dos rótulos de mês aparece.
  const estreito = window.innerWidth < 640;
  const L = estreito ? 360 : 640, A = estreito ? 230 : 260, mE = estreito ? 44 : 54, mD = 8, mT = 16, mB = 34;
  const larguraUtil = L - mE - mD, alturaUtil = A - mT - mB;
  const maximo = Math.max(1, ...meses.map((m) => Math.max(m.previsto, m.recebido)));
  const teto = escalaBonita(maximo);
  const grupo = larguraUtil / meses.length;
  const barra = Math.min(18, (grupo - 10) / 2 - 1);
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
    const rotulo = m.previsto > 0 && barra >= 14 ? `<text class="rotulo-valor" x="${xP + barra / 2}" y="${(y(m.previsto) - 4).toFixed(1)}" text-anchor="middle">${esc(moedaCurta(m.previsto).replace('R$ ', ''))}</text>` : '';
    return `<g class="grupo" data-indice="${i}">
      <rect class="barra-fundo" x="${x0}" y="${mT}" width="${grupo}" height="${alturaUtil}"/>
      ${barraArredondada(xP, y(m.previsto), barra, hP, 'barra-previsto')}
      ${barraArredondada(xR, y(m.recebido), barra, hR, 'barra-recebido')}
      ${rotulo}
      ${!estreito || i % 2 === 0 ? `<text x="${xc}" y="${A - mB + 16}" text-anchor="middle">${esc(mesCurto(m.mes))}</text>` : ''}
    </g>`;
  }).join('');

  return `<svg class="grafico" viewBox="0 0 ${L} ${A}" role="img" aria-label="Previsão de recebimentos por mês, previsto e recebido">
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
    g.addEventListener('mouseleave', () => { if (tip) { tip.remove(); tip = null; } });
  });
  container.addEventListener('touchend', () => { if (tip) { setTimeout(() => { if (tip) { tip.remove(); tip = null; } }, 1500); } }, { passive: true });
}
