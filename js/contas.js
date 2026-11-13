'use strict';
/**
 * contas.js — telas de Pagamentos (o que a Habitar tem a pagar) e Empréstimos
 * (valores que o Nizar, a Adriana ou a Habitar emprestaram e têm data para receber).
 *
 * As duas seções usam o mesmo código, mudando só a configuração em CONTAS_TIPOS.
 * As parcelas reaproveitam as ações da tela Parcelas (baixa, estorno, editar, excluir).
 */

const CONTAS_TIPOS = {
  pagamento: {
    tipo: 'pagamento', rota: 'pagamentos', titulo: 'Pagamentos', singular: 'pagamento', Singular: 'Pagamento',
    novo: 'Novo pagamento', artigo: 'o', prefixo: 'PG',
    campoNome: 'favorecido', rotuloNome: 'Favorecido',
    campoValor: 'valor_total', rotuloValor: 'valor total',
    rotuloQuitado: 'Pago', rotuloSaldo: 'A pagar', rotuloQuitadaSit: 'Pago',
    filtroExtra: { campo: 'categoria', vazio: 'Todas as categorias' },
    sugestoes: ['Fornecedor', 'Comissão', 'Impostos e taxas', 'Aluguel', 'Condomínio', 'Serviços', 'Marketing', 'Manutenção', 'Outro'],
    vazio: 'Nenhum pagamento cadastrado. Use "+ Novo pagamento" para lançar uma conta a pagar.',
  },
  emprestimo: {
    tipo: 'emprestimo', rota: 'emprestimos', titulo: 'Empréstimos', singular: 'empréstimo', Singular: 'Empréstimo',
    novo: 'Novo empréstimo', artigo: 'o', prefixo: 'EM',
    campoNome: 'devedor_nome', rotuloNome: 'Para quem',
    campoValor: 'valor_a_receber', rotuloValor: 'valor a receber',
    rotuloQuitado: 'Recebido', rotuloSaldo: 'A receber', rotuloQuitadaSit: 'Quitado',
    filtroExtra: { campo: 'credor', vazio: 'Todos os credores' },
    sugestoes: ['Nizar', 'Adriana', 'Habitar Imóveis'],
    vazio: 'Nenhum empréstimo cadastrado. Use "+ Novo empréstimo" para registrar um valor emprestado.',
  },
};

/** Rótulo da situação do registro (o backend usa "Quitada" para todos). */
function situacaoConta(cfg, r) {
  return r.situacao === 'Quitada' ? cfg.rotuloQuitadaSit : r.situacao;
}

/** Parcela no formato que as ações da tela Parcelas esperam. */
function parcelaDeConta(cfg, r, p) {
  return Object.assign({}, p, {
    tipo: cfg.tipo,
    cliente_nome: r.nome,
    cliente_telefone: cfg.tipo === 'emprestimo' ? r.devedor_telefone : '',
    imovel: cfg.tipo === 'pagamento' ? [r.descricao, r.categoria].filter(Boolean).join(' · ') : `Empréstimo${r.credor ? ` de ${r.credor}` : ''}`,
    total_parcelas_venda: r.total_parcelas,
  });
}

const contas = {
  estado: {
    pagamento: { busca: '', situacao: '', extra: '', ordem: { campo: 'proximo_vencimento', dir: 'asc' }, pagina: 1, porPagina: 20 },
    emprestimo: { busca: '', situacao: '', extra: '', ordem: { campo: 'proximo_vencimento', dir: 'asc' }, pagina: 1, porPagina: 20 },
  },

  // ───────────── Lista ─────────────

  async mostrar(tipo) {
    const cfg = CONTAS_TIPOS[tipo];
    const raiz = el(`vista-${cfg.rota}`);
    raiz.innerHTML = `<div class="cards-resumo cards-4">${skeleton(4, 86).replace(/<div class="skeleton"/g, '<div class="skeleton" style="margin:0"')}</div><div class="cartao">${skeleton(6, 44)}</div>`;
    const lista = await dados.carregarContratos(tipo);
    this.renderTela(cfg, lista);
  },

  renderTela(cfg, lista) {
    const st = this.estado[cfg.tipo];
    const raiz = el(`vista-${cfg.rota}`);
    const extras = Array.from(new Set(lista.map((r) => r[cfg.filtroExtra.campo]).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const soma = (f) => centavos(lista.reduce((s, r) => s + (Number(r[f]) || 0), 0));
    const atrasados = lista.filter((r) => r.situacao === 'Em atraso').length;
    const abertos = lista.filter((r) => r.situacao !== 'Quitada').length;
    raiz.innerHTML = `
      <div class="cards-resumo cards-4">
        ${card(cfg.rotuloSaldo, moeda(soma('saldo')), `${abertos} ${cfg.singular}${abertos === 1 ? '' : 's'} em aberto`)}
        ${card('Em atraso', moeda(soma('valor_atrasado')), `${atrasados} ${cfg.singular}${atrasados === 1 ? '' : 's'} com atraso`, 'card-atraso')}
        ${card('Vence em 30 dias', moeda(soma('vence_30_dias')), 'parcelas dos próximos 30 dias', 'card-breve')}
        ${card(`Já ${cfg.rotuloQuitado.toLowerCase()}`, moeda(soma('total_recebido')), 'parcelas quitadas', 'card-recebido')}
      </div>
      <div class="barra-ferramentas">
        <input id="ct-${cfg.tipo}-busca" type="search" class="campo" placeholder="Buscar por nome, descrição ou telefone" value="${esc(st.busca)}" autocomplete="off">
        <select id="ct-${cfg.tipo}-situacao" class="campo">${opcoesSelect([
          { valor: 'Em atraso', rotulo: 'Em atraso' }, { valor: 'Em dia', rotulo: 'Em dia' }, { valor: 'Quitada', rotulo: cfg.rotuloQuitadaSit },
        ], st.situacao, 'Todas as situações')}</select>
        <select id="ct-${cfg.tipo}-extra" class="campo">${opcoesSelect(extras, st.extra, cfg.filtroExtra.vazio)}</select>
        <button class="botao botao-secundario" type="button" data-ct="csv">Exportar CSV</button>
        <button class="botao botao-primario" type="button" data-ct="novo">+ ${esc(cfg.novo)}</button>
      </div>
      <div class="cartao"><div id="ct-${cfg.tipo}-lista"></div></div>`;
    el(`ct-${cfg.tipo}-busca`).addEventListener('input', debounce((e) => { st.busca = e.target.value; st.pagina = 1; this.renderLista(cfg); }, 200));
    el(`ct-${cfg.tipo}-situacao`).addEventListener('change', (e) => { st.situacao = e.target.value; st.pagina = 1; this.renderLista(cfg); });
    el(`ct-${cfg.tipo}-extra`).addEventListener('change', (e) => { st.extra = e.target.value; st.pagina = 1; this.renderLista(cfg); });
    raiz.querySelector('[data-ct="csv"]').addEventListener('click', () => this.exportar(cfg));
    raiz.querySelector('[data-ct="novo"]').addEventListener('click', () => this.abrirFormulario(cfg, null));
    raiz.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ct-acao]');
      if (!b) return;
      const r = (dados.contratos[cfg.tipo] || []).find((x) => x.id === b.dataset.id);
      if (!r) return;
      if (b.dataset.ctAcao === 'editar') this.editar(cfg, r.id);
      else if (b.dataset.ctAcao === 'excluir') this.excluir(cfg, r);
    });
    this.renderLista(cfg);
  },

  filtrados(cfg) {
    const st = this.estado[cfg.tipo];
    const termo = semAcento(st.busca.trim());
    const lista = (dados.contratos[cfg.tipo] || []).filter((r) =>
      (!st.situacao || r.situacao === st.situacao) &&
      (!st.extra || r[cfg.filtroExtra.campo] === st.extra) &&
      (!termo || semAcento([r.nome, r.descricao, r.categoria, r.credor, r.devedor_telefone, r.documento, r.id].join(' ')).includes(termo)));
    return ordenar(lista, st.ordem);
  },

  renderLista(cfg) {
    const st = this.estado[cfg.tipo];
    const alvo = el(`ct-${cfg.tipo}-lista`);
    if (!alvo) return;
    const lista = this.filtrados(cfg);
    if (!(dados.contratos[cfg.tipo] || []).length) { alvo.innerHTML = `<p class="vazio">${esc(cfg.vazio)}</p>`; return; }
    if (!lista.length) { alvo.innerHTML = '<p class="vazio">Nada encontrado com esses filtros.</p>'; return; }
    const { fatia, html: paginacao } = paginar(lista, st);
    const sub = (r) => cfg.tipo === 'pagamento'
      ? [r.descricao, r.categoria].filter(Boolean).join(' · ')
      : `Emprestado por ${r.credor || '—'} em ${dataBr(r.data_emprestimo)}`;
    alvo.innerHTML = `
      <div class="tabela-rolagem">
      <table class="tabela tabela-responsiva">
        <thead><tr>
          ${th(cfg.tipo === 'pagamento' ? 'Favorecido / descrição' : 'Para quem / credor', 'nome', st.ordem)}
          ${th('Total', 'valor_total_ref', st.ordem, 'num')}
          ${th(cfg.rotuloQuitado, 'total_recebido', st.ordem, 'num')}
          ${th(cfg.rotuloSaldo, 'saldo', st.ordem, 'num')}
          ${th('Parcelas', 'parcelas_pagas', st.ordem)}
          ${th('Próx. venc.', 'proximo_vencimento', st.ordem)}
          ${th('Situação', 'situacao', st.ordem)}
          <th class="acoes"></th>
        </tr></thead>
        <tbody>${fatia.map((r) => `
          <tr class="${r.situacao === 'Em atraso' ? 'linha-atrasada' : ''}">
            <td class="principal-cel"><strong><a href="#/${cfg.rota}/${esc(r.id)}">${esc(r.nome)}</a></strong><small>${esc(sub(r))}</small></td>
            <td data-rotulo="Total" class="num">${esc(moeda(r.valor_total_ref))}</td>
            <td data-rotulo="${esc(cfg.rotuloQuitado)}" class="num">${esc(moeda(r.total_recebido))}</td>
            <td data-rotulo="${esc(cfg.rotuloSaldo)}" class="num">${esc(moeda(r.saldo))}</td>
            <td data-rotulo="Parcelas" class="num">${r.parcelas_pagas}/${r.total_parcelas}</td>
            <td data-rotulo="Próx. venc." class="num">${esc(dataBr(r.proximo_vencimento))}</td>
            <td data-rotulo="Situação">${pilula(r.situacao, r.situacao === 'Em atraso' ? `Em atraso ${r.maior_atraso}d` : situacaoConta(cfg, r))} ${r.conferencia_ok ? '' : pilula('Conferir', 'Conferir')}</td>
            <td class="acoes"><div class="botoes-linha" style="justify-content:flex-end">
              <a class="botao botao-secundario botao-pequeno" href="#/${cfg.rota}/${esc(r.id)}">Abrir</a>
              <button class="botao botao-secundario botao-pequeno" type="button" data-ct-acao="editar" data-id="${esc(r.id)}">Editar</button>
              <button class="botao botao-secundario botao-pequeno" type="button" data-ct-acao="excluir" data-id="${esc(r.id)}" aria-label="Excluir">✕</button>
            </div></td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>${paginacao}`;
    ligarOrdenacao(alvo, st, () => this.renderLista(cfg));
  },

  // ───────────── Detalhe ─────────────

  async mostrarDetalhe(tipo, id) {
    const cfg = CONTAS_TIPOS[tipo];
    const raiz = el(`vista-${tipo}`);
    raiz.innerHTML = `<a class="voltar" href="#/${cfg.rota}">‹ ${esc(cfg.titulo)}</a><div class="cartao">${skeleton(6, 40)}</div>`;
    const resp = await api('getContrato', { tipo, id });
    dados.hoje = resp.hoje;
    const r = resp.registro;
    const total = r.valor_total_ref;
    const percentual = total > 0 ? Math.min(100, Math.round((r.total_recebido / total) * 100)) : 0;
    const lista = r.parcelas.map((p) => parcelaDeConta(cfg, r, p));
    const dadosHtml = cfg.tipo === 'pagamento' ? `
        <dt>Favorecido</dt><dd>${esc(r.favorecido)}</dd>
        <dt>Descrição</dt><dd>${esc(r.descricao)}</dd>
        <dt>Categoria</dt><dd>${esc(r.categoria || '—')}</dd>
        <dt>Documento</dt><dd>${esc(r.documento || '—')}</dd>` : `
        <dt>Quem emprestou</dt><dd>${esc(r.credor)}</dd>
        <dt>Para quem</dt><dd>${esc(r.devedor_nome)}</dd>
        <dt>WhatsApp</dt><dd>${r.devedor_telefone ? `<a href="https://wa.me/55${esc(r.devedor_telefone.replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(r.devedor_telefone)}</a>` : '—'}</dd>
        <dt>CPF</dt><dd>${esc(r.devedor_cpf || '—')}</dd>
        <dt>Valor emprestado</dt><dd class="num">${esc(moeda(r.valor_emprestado))}</dd>
        <dt>Data do empréstimo</dt><dd class="num">${esc(dataBr(r.data_emprestimo))}</dd>
        ${r.valor_a_receber !== r.valor_emprestado ? `<dt>Acréscimo</dt><dd class="num">${esc(moeda(r.valor_a_receber - r.valor_emprestado))}</dd>` : ''}`;
    raiz.innerHTML = `
      <a class="voltar" href="#/${cfg.rota}">‹ ${esc(cfg.titulo)}</a>
      <div class="detalhe-cabecalho">
        <div>
          <h2>${esc(r.nome)} <span class="nota" style="font-weight:400">${esc(r.id)}</span></h2>
          <p class="nota" style="margin-top:2px">${esc(cfg.tipo === 'pagamento' ? r.descricao : `Empréstimo de ${r.credor}`)}</p>
        </div>
        <div class="botoes-linha">
          ${pilula(r.situacao, r.situacao === 'Em atraso' ? `Em atraso há ${r.maior_atraso} dia${r.maior_atraso === 1 ? '' : 's'}` : situacaoConta(cfg, r))}
          <button class="botao botao-secundario botao-pequeno" type="button" data-ct-det="editar">Editar</button>
          <button class="botao botao-secundario botao-pequeno" type="button" data-ct-det="excluir">Excluir</button>
        </div>
      </div>
      <div class="detalhe-grade">
        <div class="cartao">
          <div class="cartao-titulo"><h2>Dados d${cfg.artigo} ${esc(cfg.singular)}</h2></div>
          <dl class="lista-dados">
            ${dadosHtml}
            <dt>Condição</dt><dd>${r.num_parcelas}x ${esc(r.periodicidade.toLowerCase())}</dd>
            <dt>1º vencimento</dt><dd class="num">${esc(dataBr(r.primeiro_vencimento))}</dd>
            ${r.observacoes ? `<dt>Observações</dt><dd>${esc(r.observacoes)}</dd>` : ''}
            <dt>Cadastro</dt><dd class="nota" style="margin:0">${esc(dataHoraBr(r.criado_em))} por ${esc(r.criado_por)}${r.atualizado_em && r.atualizado_em !== r.criado_em ? `<br>editado ${esc(dataHoraBr(r.atualizado_em))} por ${esc(r.atualizado_por)}` : ''}</dd>
          </dl>
        </div>
        <div class="cartao">
          <div class="cartao-titulo"><h2>Resumo financeiro</h2><span class="nota" style="margin:0">${percentual}% ${esc(cfg.rotuloQuitado.toLowerCase())}</span></div>
          <div class="progresso"><span style="width:${percentual}%"></span></div>
          <div class="resumo-financeiro">
            <div><div class="rotulo-card">Total</div><div class="valor-card">${esc(moeda(total))}</div></div>
            <div><div class="rotulo-card">${esc(cfg.rotuloQuitado)}</div><div class="valor-card" style="color:var(--verde)">${esc(moeda(r.total_recebido))}</div></div>
            <div><div class="rotulo-card">${esc(cfg.rotuloSaldo)}</div><div class="valor-card" ${r.saldo > 0 && r.situacao === 'Em atraso' ? 'style="color:var(--vermelho)"' : ''}>${esc(moeda(r.saldo))}</div></div>
          </div>
          <p class="nota">Parcelas quitadas: <strong>${r.parcelas_pagas}/${r.total_parcelas}</strong> · próximo vencimento: <strong>${esc(dataBr(r.proximo_vencimento))}</strong></p>
          ${r.conferencia_ok ? '' : `<div class="alerta alerta-roxo">⚠ Parcelas não batem com o ${esc(cfg.rotuloValor)}: somam ${esc(moeda(r.soma_parcelas))} e o ${esc(cfg.rotuloValor)} é ${esc(moeda(total))}.</div>`}
        </div>
      </div>
      <div class="cartao" style="margin-top:16px">
        <div class="cartao-titulo"><h2>Parcelas</h2><button class="botao botao-secundario botao-pequeno" type="button" data-ct-det="nova-parcela">+ Parcela avulsa</button></div>
        <div class="tabela-rolagem">
        <table class="tabela tabela-responsiva">
          <thead><tr><th>Parcela</th><th class="num">Valor</th><th>Vencimento</th><th>Situação</th><th>${cfg.tipo === 'pagamento' ? 'Pago em' : 'Recebido em'}</th><th class="acoes"></th></tr></thead>
          <tbody>${lista.length ? lista.map((p) => `
            <tr class="${p.situacao === 'Atrasado' ? 'linha-atrasada' : ''}">
              <td class="principal-cel"><strong>Parcela ${p.numero}/${r.total_parcelas}</strong>${p.observacoes ? `<small>${esc(p.observacoes)}</small>` : ''}</td>
              <td data-rotulo="Valor" class="num"><span class="pilha">${esc(moeda(p.valor))}${p.status === 'Pago' && p.valor_pago != null && Math.abs(p.valor_pago - p.valor) > 0.005 ? `<small class="nota">${cfg.tipo === 'pagamento' ? 'pago' : 'recebido'} ${esc(moeda(p.valor_pago))}</small>` : ''}</span></td>
              <td data-rotulo="Vencimento" class="num">${esc(dataBr(p.vencimento))}</td>
              <td data-rotulo="Situação">${pilula(p.situacao, p.situacao === 'Atrasado' ? `Atrasado ${p.dias_atraso}d` : p.situacao)}</td>
              <td data-rotulo="${cfg.tipo === 'pagamento' ? 'Pago em' : 'Recebido em'}" class="num">${p.status === 'Pago' ? `<span class="pilha">${esc(dataBr(p.data_pagamento))}<small class="nota">${esc(p.forma_pagamento)}</small></span>` : '—'}</td>
              <td class="acoes">${parcelas.botoesLinha(p)}</td>
            </tr>`).join('') : '<tr><td colspan="6" class="vazio">Nenhuma parcela cadastrada.</td></tr>'}
          </tbody>
        </table>
        </div>
      </div>`;
    raiz.querySelector('[data-ct-det="editar"]').addEventListener('click', () => this.abrirFormulario(cfg, r));
    raiz.querySelector('[data-ct-det="excluir"]').addEventListener('click', () => this.excluir(cfg, r));
    raiz.querySelector('[data-ct-det="nova-parcela"]').addEventListener('click', () => parcelas.abrirFormulario(r.id, null));
    raiz.addEventListener('click', (e) => parcelas.tratarClique(e, lista));
  },

  async editar(cfg, id) {
    try {
      const resp = await api('getContrato', { tipo: cfg.tipo, id });
      this.abrirFormulario(cfg, resp.registro);
    } catch (erro) {
      if (erro.codigo !== 'SESSAO') toast(erro.message, 'erro');
    }
  },

  async excluir(cfg, r) {
    const ok = await confirmar(`Excluir ${cfg.singular}`, `Excluir ${cfg.artigo} ${esc(cfg.singular)} de <strong>${esc(r.nome)}</strong> e todas as suas parcelas? Os registros ficam guardados na planilha como inativos e aparecem no histórico.`, { ok: 'Excluir', perigo: true });
    if (!ok) return;
    await executarEscrita(null, 'deleteContrato', { tipo: cfg.tipo, id: r.id }, `${cfg.Singular} excluído.`).then(() => {
      if (app.rotaAtual === cfg.tipo) location.hash = `#/${cfg.rota}`;
    }).catch(() => {});
  },

  // ───────────── Formulário ─────────────

  camposFormulario(cfg, r) {
    const v = (campo) => esc(r ? (r[campo] == null ? '' : r[campo]) : '');
    const m = (campo) => esc(r ? moedaCampo(r[campo]) : '');
    const lista = `<datalist id="ct-sugestoes">${cfg.sugestoes.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>`;
    if (cfg.tipo === 'pagamento') {
      return `
        <label class="rotulo col-2">Favorecido (a quem vamos pagar) *<input name="favorecido" class="campo" value="${v('favorecido')}" maxlength="200" required></label>
        <label class="rotulo col-2">Descrição *<input name="descricao" class="campo" value="${v('descricao')}" maxlength="200" placeholder="Ex.: Comissão da venda do Apto 204, conta de luz de novembro" required></label>
        <label class="rotulo">Categoria<input name="categoria" class="campo" value="${v('categoria')}" maxlength="80" list="ct-sugestoes"></label>
        <label class="rotulo">Documento (boleto, NF…)<input name="documento" class="campo" value="${v('documento')}" maxlength="80"></label>
        ${lista}`;
    }
    return `
      <label class="rotulo">Quem emprestou *<input name="credor" class="campo" value="${v('credor')}" maxlength="80" list="ct-sugestoes" placeholder="Nizar, Adriana…" required></label>
      <label class="rotulo">Data do empréstimo<input name="data_emprestimo" class="campo" type="date" value="${esc(r ? r.data_emprestimo : (dados.hoje || hojeIso()))}"></label>
      <label class="rotulo col-2">Para quem (devedor) *<input name="devedor_nome" class="campo" value="${v('devedor_nome')}" maxlength="200" required></label>
      <label class="rotulo">WhatsApp<input name="devedor_telefone" class="campo" inputmode="tel" placeholder="(64) 99999-9999" value="${v('devedor_telefone')}"></label>
      <label class="rotulo">CPF<input name="devedor_cpf" class="campo" inputmode="numeric" placeholder="000.000.000-00" value="${v('devedor_cpf')}"></label>
      <label class="rotulo">Valor emprestado (R$) *<input name="valor_emprestado" class="campo campo-moeda" inputmode="decimal" value="${m('valor_emprestado')}" required></label>
      ${lista}`;
  },

  abrirFormulario(cfg, r) {
    const editando = !!r;
    const pagas = editando ? r.parcelas.filter((p) => p.status === 'Pago') : [];
    const ehEmprestimo = cfg.tipo === 'emprestimo';
    abrirModal(editando ? `Editar ${cfg.singular} ${r.id}` : cfg.novo, `
      <form id="form-conta" novalidate>
        <div class="form-grade">${this.camposFormulario(cfg, r)}</div>
        <div class="form-secao">
          <h3>Condição de pagamento</h3>
          <div class="form-grade">
            <label class="rotulo">${ehEmprestimo ? 'Valor a receber (R$) *' : 'Valor total (R$) *'}
              <input name="${cfg.campoValor}" class="campo campo-moeda" inputmode="decimal" value="${esc(editando ? moedaCampo(r[cfg.campoValor]) : '')}" required>
              ${ehEmprestimo ? '<small class="nota" style="margin:0">Igual ao emprestado, ou maior se houver juros.</small>' : ''}
            </label>
            <label class="rotulo">Nº de parcelas *<input name="num_parcelas" class="campo" type="number" min="1" max="240" step="1" value="${esc(editando ? r.num_parcelas : 1)}" required></label>
            <label class="rotulo">1º vencimento *<input name="primeiro_vencimento" class="campo" type="date" value="${esc(editando ? r.primeiro_vencimento : '')}" required></label>
            <label class="rotulo">Periodicidade<select name="periodicidade" class="campo">${opcoesSelect(PERIODICIDADES, editando ? r.periodicidade : 'Mensal')}</select></label>
            <label class="rotulo col-2">Observações<textarea name="observacoes" class="campo" maxlength="1000">${esc(editando ? r.observacoes : '')}</textarea></label>
          </div>
        </div>
        <div class="form-secao">
          <h3>Prévia das parcelas <button class="botao botao-secundario botao-pequeno" type="button" data-acao="previa-gerar">Recalcular parcelas</button></h3>
          ${pagas.length ? `<div class="alerta alerta-ambar" style="margin:0 0 10px">Já existe(m) ${pagas.length} parcela(s) quitada(s). Elas não mudam: o recálculo só redistribui o que falta entre as parcelas em aberto.</div>` : ''}
          <div id="previa-conta"></div>
        </div>
        <p id="conta-erro" class="erro-campo" hidden></p>
        <div class="modal-botoes">
          <button class="botao botao-secundario" type="button" data-acao="fechar-modal">Cancelar</button>
          <button class="botao botao-primario" type="submit">${editando ? 'Salvar alterações' : 'Cadastrar'}</button>
        </div>
      </form>`, { larga: true });

    const f = el('form-conta');
    const previa = ligarPreviaParcelas(f, { campoValor: cfg.campoValor, alvo: el('previa-conta'), rotulo: cfg.rotuloValor, parcelas: editando ? r.parcelas : [] });

    if (ehEmprestimo) {
      f.devedor_telefone.addEventListener('input', (e) => { e.target.value = mascaraTelefone(e.target.value); });
      f.devedor_cpf.addEventListener('input', (e) => { e.target.value = mascaraCpf(e.target.value); });
      // O valor a receber acompanha o emprestado até a pessoa mexer nele (juros).
      let receberEditado = editando;
      f.valor_a_receber.addEventListener('input', () => { receberEditado = true; });
      f.valor_emprestado.addEventListener('input', () => {
        if (receberEditado) return;
        f.valor_a_receber.value = f.valor_emprestado.value;
        previa.gerar();
      });
    }

    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const erro = el('conta-erro');
      const campos = { tipo: cfg.tipo, id: editando ? r.id : '' };
      qa('input[name], select[name], textarea[name]', f).forEach((c) => { campos[c.name] = c.value.trim(); });
      ['valor_total', 'valor_emprestado', 'valor_a_receber'].forEach((k) => { if (k in campos) campos[k] = campos[k] === '' ? null : lerMoeda(campos[k]); });
      campos.num_parcelas = Number(campos.num_parcelas);
      qa('.campo-erro', f).forEach((c) => c.classList.remove('campo-erro'));
      const falhar = (campo, msg) => { if (campo && f[campo]) f[campo].classList.add('campo-erro'); mostrarErro(erro, msg); };
      if (cfg.tipo === 'pagamento') {
        if (!campos.favorecido) return falhar('favorecido', 'Informe a quem vamos pagar.');
        if (!campos.descricao) return falhar('descricao', 'Informe a descrição.');
      } else {
        if (!campos.credor) return falhar('credor', 'Informe quem emprestou.');
        if (!campos.devedor_nome) return falhar('devedor_nome', 'Informe para quem foi o empréstimo.');
        if (!(campos.valor_emprestado > 0)) return falhar('valor_emprestado', 'O valor emprestado precisa ser maior que zero.');
        if (campos.valor_a_receber == null) campos.valor_a_receber = campos.valor_emprestado;
      }
      const total = campos[cfg.campoValor];
      if (!(total > 0)) return falhar(cfg.campoValor, `O ${cfg.rotuloValor} precisa ser maior que zero.`);
      if (!Number.isInteger(campos.num_parcelas) || campos.num_parcelas < 1) return falhar('num_parcelas', 'O nº de parcelas precisa ser um inteiro a partir de 1.');
      if (!dataValida(campos.primeiro_vencimento)) return falhar('primeiro_vencimento', 'Informe o 1º vencimento.');
      const problema = await conferirPrevia(previa.obter(), total, cfg.rotuloValor, `${cfg.artigo.toUpperCase()} ${cfg.singular}`);
      if (problema === 'cancelado') return;
      if (problema) return falhar(null, problema);
      erro.hidden = true;
      campos.parcelas = parcelasParaEnvio(previa.obter());
      await this.salvar(cfg, f, campos, editando);
    });
  },

  async salvar(cfg, f, campos, editando) {
    const botao = f && f.isConnected ? f.querySelector('[type=submit]') : null;
    const msg = editando ? `${cfg.Singular} atualizado.` : `${cfg.Singular} cadastrado com ${campos.parcelas.length} parcela(s).`;
    try {
      await executarEscrita(botao, 'saveContrato', campos, msg);
    } catch (erro) {
      if (erro.codigo === 'CONFIRMAR') {
        const ok = await confirmar('Recalcular parcelas em aberto', `${esc(erro.message)}<br><br>As parcelas quitadas continuam exatamente como estão.`, { ok: 'Confirmar e salvar' });
        if (ok) await executarEscrita(null, 'saveContrato', Object.assign({ confirmarRecalculo: true }, campos), msg).catch(() => {});
      }
    }
  },

  exportar(cfg) {
    const colunas = [{ rotulo: 'Código', valor: (r) => r.id }];
    if (cfg.tipo === 'pagamento') {
      colunas.push(
        { rotulo: 'Favorecido', valor: (r) => r.favorecido },
        { rotulo: 'Descrição', valor: (r) => r.descricao },
        { rotulo: 'Categoria', valor: (r) => r.categoria },
        { rotulo: 'Documento', valor: (r) => r.documento });
    } else {
      colunas.push(
        { rotulo: 'Quem emprestou', valor: (r) => r.credor },
        { rotulo: 'Para quem', valor: (r) => r.devedor_nome },
        { rotulo: 'Telefone', valor: (r) => r.devedor_telefone },
        { rotulo: 'Valor emprestado', valor: (r) => moedaCampo(r.valor_emprestado) },
        { rotulo: 'Data do empréstimo', valor: (r) => dataBr(r.data_emprestimo) });
    }
    colunas.push(
      { rotulo: 'Total', valor: (r) => moedaCampo(r.valor_total_ref) },
      { rotulo: cfg.rotuloQuitado, valor: (r) => moedaCampo(r.total_recebido) },
      { rotulo: cfg.rotuloSaldo, valor: (r) => moedaCampo(r.saldo) },
      { rotulo: 'Parcelas', valor: (r) => `${r.parcelas_pagas}/${r.total_parcelas}` },
      { rotulo: 'Próximo vencimento', valor: (r) => dataBr(r.proximo_vencimento) },
      { rotulo: 'Situação', valor: (r) => situacaoConta(cfg, r) },
      { rotulo: 'Observações', valor: (r) => r.observacoes });
    exportarCsv(cfg.rota, colunas, this.filtrados(cfg));
  },
};
