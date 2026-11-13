'use strict';
/**
 * parcelas.js — lista de parcelas, baixa, estorno, parcelas avulsas.
 * As ações por parcela (botões e cliques) também são usadas no detalhe da venda.
 */

const SITUACOES_PARCELA = ['Atrasado', 'Vence em até 7 dias', 'A vencer', 'Pago'];

const parcelas = {
  busca: '', situacao: '', status: '', mes: '', cliente: '', forma: '',
  ordem: { campo: 'vencimento', dir: 'asc' },
  pagina: 1, porPagina: 25,

  async mostrar() {
    const raiz = el('vista-parcelas');
    raiz.innerHTML = `<div class="cartao">${skeleton(8, 44)}</div>`;
    const lista = await dados.carregarParcelas();
    this.renderTela(lista);
  },

  renderTela(lista) {
    const raiz = el('vista-parcelas');
    const meses = Array.from(new Set(lista.map((p) => (p.vencimento || '').slice(0, 7)).filter(Boolean))).sort();
    const clientes = Array.from(new Set(lista.map((p) => p.cliente_nome).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    raiz.innerHTML = `
      <div class="barra-ferramentas">
        <input id="par-busca" type="search" class="campo" placeholder="Buscar por cliente, imóvel ou telefone" value="${esc(this.busca)}" autocomplete="off">
        <select id="par-situacao" class="campo">${opcoesSelect(SITUACOES_PARCELA, this.situacao, 'Todas as situações')}</select>
        <select id="par-status" class="campo">${opcoesSelect(['A pagar', 'Pago'], this.status, 'Pagas e a pagar')}</select>
        <select id="par-mes" class="campo">${opcoesSelect(meses.map((m) => ({ valor: m, rotulo: mesLongo(m) })), this.mes, 'Todos os meses')}</select>
        <select id="par-cliente" class="campo">${opcoesSelect(clientes, this.cliente, 'Todos os clientes')}</select>
        <select id="par-forma" class="campo">${opcoesSelect(FORMAS_PAGAMENTO, this.forma, 'Toda forma de pagamento')}</select>
        <button class="botao botao-secundario" type="button" data-acao="par-limpar">Limpar</button>
        <button class="botao botao-secundario" type="button" data-acao="par-csv">Exportar CSV</button>
      </div>
      <div class="cartao"><div id="par-lista"></div></div>`;
    el('par-busca').addEventListener('input', debounce((e) => { this.busca = e.target.value; this.pagina = 1; this.renderLista(); }, 200));
    ['situacao', 'status', 'mes', 'cliente', 'forma'].forEach((campo) => {
      el(`par-${campo}`).addEventListener('change', (e) => { this[campo] = e.target.value; this.pagina = 1; this.renderLista(); });
    });
    raiz.querySelector('[data-acao="par-limpar"]').addEventListener('click', () => {
      Object.assign(this, { busca: '', situacao: '', status: '', mes: '', cliente: '', forma: '', pagina: 1 });
      this.renderTela(lista);
      this.renderLista();
    });
    raiz.querySelector('[data-acao="par-csv"]').addEventListener('click', () => this.exportar());
    raiz.addEventListener('click', (e) => this.tratarClique(e, dados.parcelas || []));
    this.renderLista();
  },

  filtradas() {
    const termo = semAcento(this.busca.trim());
    const lista = (dados.parcelas || []).filter((p) =>
      (!this.situacao || p.situacao === this.situacao) &&
      (!this.status || p.status === this.status) &&
      (!this.mes || (p.vencimento || '').slice(0, 7) === this.mes) &&
      (!this.cliente || p.cliente_nome === this.cliente) &&
      (!this.forma || p.forma_pagamento === this.forma) &&
      (!termo || semAcento([p.cliente_nome, p.imovel, p.cliente_telefone, p.venda_id].join(' ')).includes(termo)));
    return ordenar(lista, this.ordem);
  },

  renderLista() {
    const alvo = el('par-lista');
    if (!alvo) return;
    const lista = this.filtradas();
    const totalAberto = lista.filter((p) => p.status !== 'Pago').reduce((s, p) => s + p.valor, 0);
    const { fatia, html: paginacao } = paginar(lista, this);
    if (!lista.length) { alvo.innerHTML = '<p class="vazio">Nenhuma parcela encontrada com esses filtros.</p>'; return; }
    alvo.innerHTML = `
      <p class="filtros-ativos" style="margin:0 0 10px">${lista.length} parcela(s) · em aberto: <strong class="num">${esc(moeda(totalAberto))}</strong></p>
      <div class="tabela-rolagem">
      <table class="tabela tabela-responsiva">
        <thead><tr>
          ${th('Cliente / imóvel', 'cliente_nome', this.ordem)}
          ${th('Parcela', 'numero', this.ordem)}
          ${th('Valor', 'valor', this.ordem, 'num')}
          ${th('Vencimento', 'vencimento', this.ordem)}
          ${th('Situação', 'situacao', this.ordem)}
          ${th('Pagamento', 'data_pagamento', this.ordem)}
          <th class="acoes"></th>
        </tr></thead>
        <tbody>${fatia.map((p) => this.linha(p)).join('')}</tbody>
      </table>
      </div>${paginacao}`;
    ligarOrdenacao(alvo, this, () => this.renderLista());
  },

  linha(p) {
    const total = p.total_parcelas_venda ? `${p.numero}/${p.total_parcelas_venda}` : String(p.numero);
    return `<tr class="${p.situacao === 'Atrasado' ? 'linha-atrasada' : ''}" data-id="${esc(p.id)}">
      <td class="principal-cel"><strong><a href="#/vendas/${esc(p.venda_id)}">${esc(p.cliente_nome)}</a></strong><small>${esc(p.imovel)}</small></td>
      <td data-rotulo="Parcela" class="num">${esc(total)}</td>
      <td data-rotulo="Valor" class="num"><span class="pilha">${esc(moeda(p.valor))}${p.status === 'Pago' && p.valor_pago != null && Math.abs(p.valor_pago - p.valor) > 0.005 ? `<small class="nota">pago ${esc(moeda(p.valor_pago))}</small>` : ''}</span></td>
      <td data-rotulo="Vencimento" class="num">${esc(dataBr(p.vencimento))}</td>
      <td data-rotulo="Situação">${pilula(p.situacao, p.situacao === 'Atrasado' ? `Atrasado ${p.dias_atraso}d` : p.situacao)}</td>
      <td data-rotulo="Pagamento" class="num">${p.status === 'Pago' ? `<span class="pilha">${esc(dataBr(p.data_pagamento))}<small class="nota">${esc(p.forma_pagamento)}</small></span>` : '—'}</td>
      <td class="acoes">${this.botoesLinha(p)}</td>
    </tr>`;
  },

  /** Botões de ação de uma parcela (usados na lista e no detalhe da venda). */
  botoesLinha(p) {
    const whats = p.status !== 'Pago' ? linkWhatsApp(p) : '';
    return `<div class="botoes-linha" style="justify-content:flex-end">
      ${p.status === 'Pago'
        ? `<button class="botao botao-secundario botao-pequeno" type="button" data-par="estornar" data-id="${esc(p.id)}">Estornar</button>`
        : `<button class="botao botao-primario botao-pequeno" type="button" data-par="baixar" data-id="${esc(p.id)}">Dar baixa</button>`}
      ${whats ? `<a class="botao botao-whats botao-pequeno" href="${whats}" target="_blank" rel="noopener" title="Cobrar no WhatsApp">WhatsApp</a>` : ''}
      <button class="botao botao-secundario botao-pequeno" type="button" data-par="editar" data-id="${esc(p.id)}">Editar</button>
      <button class="botao botao-secundario botao-pequeno" type="button" data-par="excluir" data-id="${esc(p.id)}" aria-label="Excluir parcela">✕</button>
    </div>`;
  },

  tratarClique(e, lista) {
    const b = e.target.closest('[data-par]');
    if (!b) return;
    const p = lista.find((x) => x.id === b.dataset.id);
    if (!p) return;
    if (b.dataset.par === 'baixar') this.abrirBaixa(p);
    else if (b.dataset.par === 'estornar') this.estornar(p);
    else if (b.dataset.par === 'editar') this.abrirFormulario(p.venda_id, p);
    else if (b.dataset.par === 'excluir') this.excluir(p);
  },

  abrirBaixa(p) {
    const tituloBaixa = p.tipo === 'pagamento' ? `Registrar pagamento da parcela ${p.numero}` : p.tipo === 'emprestimo' ? `Registrar recebimento da parcela ${p.numero}` : `Dar baixa na parcela ${p.numero}`;
    abrirModal(tituloBaixa, `
      <form id="form-baixa" novalidate>
        <p class="modal-texto"><strong>${esc(p.cliente_nome || '')}</strong>${p.imovel ? ` · ${esc(p.imovel)}` : ''}<br>
          <span class="nota">Parcela de ${esc(moeda(p.valor))}, vencimento ${esc(dataBr(p.vencimento))}</span></p>
        <div class="form-grade">
          <label class="rotulo">Data do pagamento<input name="data_pagamento" class="campo" type="date" value="${esc(dados.hoje || hojeIso())}" required></label>
          <label class="rotulo">Valor pago (R$)<input name="valor_pago" class="campo campo-moeda" inputmode="decimal" value="${esc(moedaCampo(p.valor))}" required></label>
          <label class="rotulo col-2">Forma de pagamento<select name="forma_pagamento" class="campo" required>${opcoesSelect(FORMAS_PAGAMENTO, 'PIX')}</select></label>
          <label class="rotulo col-2">Observações<input name="observacoes" class="campo" value="${esc(p.observacoes || '')}" maxlength="500"></label>
        </div>
        <p id="baixa-erro" class="erro-campo" hidden></p>
        <div class="modal-botoes">
          <button class="botao botao-secundario" type="button" data-acao="fechar-modal">Cancelar</button>
          <button class="botao botao-primario" type="submit">Confirmar baixa</button>
        </div>
      </form>`);
    el('form-baixa').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const erro = el('baixa-erro');
      const valor = lerMoeda(f.valor_pago.value);
      if (!dataValida(f.data_pagamento.value)) return mostrarErro(erro, 'Informe uma data válida.');
      if (valor === null || valor <= 0) return mostrarErro(erro, 'O valor pago precisa ser maior que zero.');
      erro.hidden = true;
      await executarEscrita(f.querySelector('[type=submit]'), 'baixarParcela', {
        id: p.id, data_pagamento: f.data_pagamento.value, valor_pago: valor,
        forma_pagamento: f.forma_pagamento.value, observacoes: f.observacoes.value,
      }, p.tipo === 'pagamento' ? `Pagamento registrado: ${moeda(valor)}.` : p.tipo === 'emprestimo' ? `Recebimento registrado: ${moeda(valor)}.` : `Parcela ${p.numero} baixada: ${moeda(valor)}.`).catch(() => {});
    });
  },

  async estornar(p) {
    const ok = await confirmar('Estornar baixa', `Voltar a parcela ${p.numero} de <strong>${esc(p.cliente_nome || p.venda_id)}</strong> para "A pagar"? O pagamento de ${esc(moeda(p.valor_pago != null ? p.valor_pago : p.valor))} em ${esc(dataBr(p.data_pagamento))} será desfeito.`, { ok: 'Estornar', perigo: true });
    if (!ok) return;
    await executarEscrita(null, 'estornarParcela', { id: p.id }, `Baixa da parcela ${p.numero} estornada.`).catch(() => {});
  },

  async excluir(p) {
    if (p.status === 'Pago') { toast('Estorne a baixa antes de excluir uma parcela paga.', 'erro'); return; }
    const ok = await confirmar('Excluir parcela', `Excluir a parcela ${p.numero} de ${esc(moeda(p.valor))} (vencimento ${esc(dataBr(p.vencimento))})? Ela sai das listas e do saldo, mas fica registrada no histórico.`, { ok: 'Excluir', perigo: true });
    if (!ok) return;
    await executarEscrita(null, 'deleteParcela', { id: p.id }, 'Parcela excluída.').catch(() => {});
  },

  /** Nova parcela avulsa (p = null) ou edição de uma parcela existente. */
  abrirFormulario(vendaId, p) {
    const pago = p && p.status === 'Pago';
    abrirModal(p ? `Editar parcela ${p.numero}` : 'Nova parcela avulsa', `
      <form id="form-parcela" novalidate>
        ${p && p.cliente_nome ? `<p class="modal-texto"><strong>${esc(p.cliente_nome)}</strong> · ${esc(p.imovel)}</p>` : ''}
        <div class="form-grade">
          <label class="rotulo">Nº da parcela<input name="numero" class="campo" type="number" min="1" step="1" value="${esc(p ? p.numero : '')}" required></label>
          <label class="rotulo">Valor (R$)<input name="valor" class="campo campo-moeda" inputmode="decimal" value="${esc(p ? moedaCampo(p.valor) : '')}" required></label>
          <label class="rotulo">Vencimento<input name="vencimento" class="campo" type="date" value="${esc(p ? p.vencimento : '')}" required></label>
          <label class="rotulo">Status<select name="status" class="campo">${opcoesSelect(['A pagar', 'Pago'], pago ? 'Pago' : 'A pagar')}</select></label>
          <div id="parcela-pagamento" class="form-grade col-2" ${pago ? '' : 'hidden'}>
            <label class="rotulo">Data do pagamento<input name="data_pagamento" class="campo" type="date" value="${esc(pago ? p.data_pagamento : (dados.hoje || hojeIso()))}"></label>
            <label class="rotulo">Valor pago (R$)<input name="valor_pago" class="campo campo-moeda" inputmode="decimal" value="${esc(pago ? moedaCampo(p.valor_pago != null ? p.valor_pago : p.valor) : '')}"></label>
            <label class="rotulo col-2">Forma de pagamento<select name="forma_pagamento" class="campo">${opcoesSelect(FORMAS_PAGAMENTO, pago ? p.forma_pagamento : 'PIX')}</select></label>
          </div>
          <label class="rotulo col-2">Observações<input name="observacoes" class="campo" value="${esc(p ? p.observacoes || '' : '')}" maxlength="500"></label>
        </div>
        <p id="parcela-erro" class="erro-campo" hidden></p>
        <div class="modal-botoes">
          <button class="botao botao-secundario" type="button" data-acao="fechar-modal">Cancelar</button>
          <button class="botao botao-primario" type="submit">${p ? 'Salvar' : 'Adicionar'}</button>
        </div>
      </form>`);
    const f = el('form-parcela');
    f.status.addEventListener('change', () => { el('parcela-pagamento').hidden = f.status.value !== 'Pago'; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const erro = el('parcela-erro');
      const valor = lerMoeda(f.valor.value);
      const numero = Number(f.numero.value);
      if (!Number.isInteger(numero) || numero < 1) return mostrarErro(erro, 'O número da parcela precisa ser inteiro, a partir de 1.');
      if (valor === null || valor <= 0) return mostrarErro(erro, 'O valor precisa ser maior que zero.');
      if (!dataValida(f.vencimento.value)) return mostrarErro(erro, 'Informe um vencimento válido.');
      const payload = { id: p ? p.id : '', venda_id: vendaId, numero, valor, vencimento: f.vencimento.value, status: f.status.value, observacoes: f.observacoes.value };
      if (f.status.value === 'Pago') {
        const vp = f.valor_pago.value === '' ? valor : lerMoeda(f.valor_pago.value);
        if (!dataValida(f.data_pagamento.value)) return mostrarErro(erro, 'Informe a data do pagamento.');
        if (vp === null || vp <= 0) return mostrarErro(erro, 'O valor pago precisa ser maior que zero.');
        Object.assign(payload, { data_pagamento: f.data_pagamento.value, valor_pago: vp, forma_pagamento: f.forma_pagamento.value });
      }
      erro.hidden = true;
      await executarEscrita(f.querySelector('[type=submit]'), 'saveParcela', payload, p ? 'Parcela atualizada.' : 'Parcela adicionada.').catch(() => {});
    });
  },

  exportar() {
    exportarCsv('parcelas', [
      { rotulo: 'Venda', valor: (p) => p.venda_id },
      { rotulo: 'Cliente', valor: (p) => p.cliente_nome },
      { rotulo: 'Telefone', valor: (p) => p.cliente_telefone },
      { rotulo: 'Imóvel', valor: (p) => p.imovel },
      { rotulo: 'Parcela', valor: (p) => `${p.numero}/${p.total_parcelas_venda || ''}` },
      { rotulo: 'Valor', valor: (p) => moedaCampo(p.valor) },
      { rotulo: 'Vencimento', valor: (p) => dataBr(p.vencimento) },
      { rotulo: 'Situação', valor: (p) => p.situacao },
      { rotulo: 'Dias em atraso', valor: (p) => p.dias_atraso || '' },
      { rotulo: 'Status', valor: (p) => p.status },
      { rotulo: 'Data do pagamento', valor: (p) => p.data_pagamento ? dataBr(p.data_pagamento) : '' },
      { rotulo: 'Valor pago', valor: (p) => p.valor_pago != null ? moedaCampo(p.valor_pago) : '' },
      { rotulo: 'Forma', valor: (p) => p.forma_pagamento },
      { rotulo: 'Observações', valor: (p) => p.observacoes },
    ], this.filtradas());
  },
};

// ───────────── Ajudantes de tabela (ordenação e paginação) compartilhados ─────────────

function mostrarErro(elemento, mensagem) {
  elemento.textContent = mensagem;
  elemento.hidden = false;
}

function th(rotulo, campo, ordem, classe = '') {
  const ativo = ordem.campo === campo ? ` ${ordem.dir}` : '';
  return `<th class="ordenavel ${classe}${ativo}" data-ordenar="${esc(campo)}">${esc(rotulo)}</th>`;
}

function ordenar(lista, ordem) {
  const dir = ordem.dir === 'desc' ? -1 : 1;
  return lista.slice().sort((a, b) => {
    const x = a[ordem.campo], y = b[ordem.campo];
    if (x == null || x === '') return y == null || y === '' ? 0 : 1;
    if (y == null || y === '') return -1;
    const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true });
    return r * dir;
  });
}

function ligarOrdenacao(container, estado, aoMudar) {
  container.querySelectorAll('th[data-ordenar]').forEach((cab) => cab.addEventListener('click', () => {
    const campo = cab.dataset.ordenar;
    if (estado.ordem.campo === campo) estado.ordem.dir = estado.ordem.dir === 'asc' ? 'desc' : 'asc';
    else estado.ordem = { campo, dir: 'asc' };
    aoMudar();
  }));
  container.querySelectorAll('[data-pagina]').forEach((b) => b.addEventListener('click', () => {
    estado.pagina = Number(b.dataset.pagina);
    aoMudar();
    container.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }));
}

function paginar(lista, estado) {
  const paginas = Math.max(1, Math.ceil(lista.length / estado.porPagina));
  if (estado.pagina > paginas) estado.pagina = paginas;
  const inicio = (estado.pagina - 1) * estado.porPagina;
  const fatia = lista.slice(inicio, inicio + estado.porPagina);
  const html = paginas > 1 ? `<div class="paginacao">
      <span>${inicio + 1}–${inicio + fatia.length} de ${lista.length}</span>
      <div class="botoes-linha">
        <button class="botao botao-secundario" type="button" data-pagina="${estado.pagina - 1}" ${estado.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
        <span style="align-self:center">Página ${estado.pagina} de ${paginas}</span>
        <button class="botao botao-secundario" type="button" data-pagina="${estado.pagina + 1}" ${estado.pagina >= paginas ? 'disabled' : ''}>Próxima ›</button>
      </div></div>` : '';
  return { fatia, html };
}
