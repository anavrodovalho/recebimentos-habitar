'use strict';
/**
 * previa.js — prévia editável das parcelas, usada nos formulários de venda, pagamento e empréstimo.
 *
 * O formulário precisa ter os campos `num_parcelas`, `primeiro_vencimento`, `periodicidade`,
 * o campo de valor indicado em `campoValor` e um <div> onde a prévia é desenhada.
 * Parcelas já pagas aparecem travadas e nunca são recalculadas.
 */

/**
 * @param {HTMLFormElement} f
 * @param {object} o
 *   campoValor  nome do campo com o total que as parcelas devem somar (ex.: 'valor_entrada')
 *   alvo        elemento onde desenhar a prévia
 *   rotulo      como chamar esse total no texto ("entrada", "valor total"…)
 *   parcelas    parcelas existentes (edição) ou [] (cadastro)
 * @returns {{ obter: () => Array, gerar: () => void }}
 */
function ligarPreviaParcelas(f, o) {
  const rotulo = o.rotulo || 'valor total';
  const existentes = o.parcelas || [];
  const pagas = existentes.filter((p) => p.status === 'Pago');
  const hoje = dados.hoje || hojeIso();
  let previa = existentes.map((p) => ({ id: p.id, numero: p.numero, valor: p.valor, vencimento: p.vencimento, status: p.status, observacoes: p.observacoes }));

  const totalAlvo = () => lerMoeda(f[o.campoValor].value) || 0;

  const htmlTotal = () => {
    const alvo = totalAlvo();
    const soma = centavos(previa.reduce((s, p) => s + (Number(p.valor) || 0), 0));
    const bate = Math.abs(soma - alvo) < 0.005;
    return { bate, html: `<span>Soma das parcelas: <strong>${esc(moeda(soma))}</strong> · ${esc(rotulo)}: <strong>${esc(moeda(alvo))}</strong></span>
      <span>${bate ? `✓ Parcelas batem com o ${esc(rotulo)}` : `⚠ Parcelas não batem com o ${esc(rotulo)}`}</span>` };
  };

  const render = () => {
    const personalizada = f.periodicidade.value === 'Personalizada';
    const total = htmlTotal();
    o.alvo.innerHTML = previa.length ? `
      <div class="tabela-rolagem"><table class="tabela previa-tabela">
        <thead><tr><th>Nº</th><th>Valor (R$)</th><th>Vencimento</th><th>Status</th></tr></thead>
        <tbody>${previa.map((p, i) => p.status === 'Pago' ? `
          <tr><td class="num">${p.numero}</td><td class="num">${esc(moeda(p.valor))}</td><td class="num">${esc(dataBr(p.vencimento))}</td><td>${pilula('Pago')}</td></tr>` : `
          <tr>
            <td class="num">${p.numero}</td>
            <td><input class="campo campo-moeda" data-previa="valor" data-i="${i}" inputmode="decimal" value="${esc(moedaCampo(p.valor))}"></td>
            <td><input class="campo" data-previa="vencimento" data-i="${i}" type="date" value="${esc(p.vencimento)}" ${personalizada && !p.vencimento ? 'placeholder="preencha"' : ''}></td>
            <td>${pilula('A pagar', 'Em aberto')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="previa-total ${total.bate ? 'ok' : 'erro'}">${total.html}</div>`
      : `<p class="nota">Preencha o ${esc(rotulo)}, o nº de parcelas e o 1º vencimento para ver a prévia.</p>`;
  };

  const gerar = () => {
    const alvo = lerMoeda(f[o.campoValor].value);
    const n = Number(f.num_parcelas.value);
    const primeiro = f.primeiro_vencimento.value;
    const periodicidade = f.periodicidade.value;
    if (!alvo || alvo <= 0 || !Number.isInteger(n) || n < 1 || (!dataValida(primeiro) && periodicidade !== 'Personalizada')) { render(); return; }
    const abertasQtd = Math.max(0, n - pagas.length);
    const restante = centavos(alvo - centavos(pagas.reduce((s, p) => s + p.valor, 0)));
    let abertas = [];
    if (abertasQtd > 0 && restante > 0) {
      const inicio = periodicidade === 'Quinzenal' ? somarDias(primeiro || hoje, 15 * pagas.length)
        : periodicidade === 'Mensal' ? somarMeses(primeiro || hoje, pagas.length) : '';
      abertas = gerarParcelas(restante, abertasQtd, inicio, periodicidade, pagas.length).map((p, i) => {
        if (periodicidade === 'Personalizada') p.vencimento = pagas.length === 0 && i === 0 && dataValida(primeiro) ? primeiro : '';
        return p;
      });
    }
    previa = pagas.map((p) => ({ id: p.id, numero: p.numero, valor: p.valor, vencimento: p.vencimento, status: 'Pago' })).concat(abertas);
    render();
  };

  // Regera ao mudar os campos que definem as parcelas (no change e, com atraso, ao digitar).
  const gerarComAtraso = debounce(gerar, 400);
  [o.campoValor, 'num_parcelas', 'primeiro_vencimento', 'periodicidade'].forEach((campo) => {
    f[campo].addEventListener('change', gerar);
    f[campo].addEventListener('input', gerarComAtraso);
  });
  const botao = f.querySelector('[data-acao="previa-gerar"]');
  if (botao) botao.addEventListener('click', gerar);

  // Edição direta de valor/data: atualiza só a linha de total, sem redesenhar (para não perder o foco).
  o.alvo.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-previa]');
    if (!inp) return;
    const p = previa[Number(inp.dataset.i)];
    if (inp.dataset.previa === 'valor') p.valor = lerMoeda(inp.value) || 0;
    else p.vencimento = inp.value;
    const caixa = o.alvo.querySelector('.previa-total');
    if (caixa) {
      const total = htmlTotal();
      caixa.className = `previa-total ${total.bate ? 'ok' : 'erro'}`;
      caixa.innerHTML = total.html;
    }
  });

  if (existentes.length) render(); else gerar();
  return { obter: () => previa, gerar };
}

/**
 * Valida a prévia antes de salvar. Devolve a mensagem de erro ou ''.
 * Se a soma não bater com o total, pede confirmação (resolve false se a pessoa cancelar).
 */
async function conferirPrevia(previa, total, rotulo, nomeRegistro) {
  if (!previa.length) return 'Gere a prévia das parcelas antes de salvar.';
  for (const p of previa) {
    if (p.status === 'Pago') continue;
    if (!(Number(p.valor) > 0)) return `A parcela ${p.numero} precisa ter valor maior que zero.`;
    if (!dataValida(p.vencimento)) return `Informe o vencimento da parcela ${p.numero}.`;
  }
  const soma = centavos(previa.reduce((s, p) => s + Number(p.valor), 0));
  if (Math.abs(soma - total) >= 0.005) {
    const seguir = await confirmar('Parcelas não batem', `As parcelas somam <strong>${esc(moeda(soma))}</strong> e o ${esc(rotulo)} é <strong>${esc(moeda(total))}</strong>. Salvar mesmo assim? ${esc(nomeRegistro)} ficará marcado como "Conferir".`, { ok: 'Salvar assim mesmo' });
    if (!seguir) return 'cancelado';
  }
  return '';
}

/** Lista de parcelas no formato que o backend espera. */
function parcelasParaEnvio(previa) {
  return previa.map((p) => ({ id: p.id || '', numero: p.numero, valor: Number(p.valor), vencimento: p.vencimento, observacoes: p.observacoes || '' }));
}
