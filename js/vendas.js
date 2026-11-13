'use strict';
/**
 * vendas.js — lista de vendas, formulário (com prévia editável das parcelas) e detalhe.
 */

const SITUACOES_VENDA = ['Em atraso', 'Em dia', 'Quitada'];

const vendas = {
  busca: '', situacao: '', tipo: '', corretor: '',
  ordem: { campo: 'criado_em', dir: 'desc' },
  pagina: 1, porPagina: 20,

  async mostrar() {
    const raiz = el('vista-vendas');
    raiz.innerHTML = `<div class="cartao">${skeleton(8, 44)}</div>`;
    const lista = await dados.carregarVendas();
    this.renderTela(lista);
  },

  renderTela(lista) {
    const raiz = el('vista-vendas');
    const corretores = Array.from(new Set(lista.map((v) => v.corretor).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    raiz.innerHTML = `
      <div class="barra-ferramentas">
        <input id="ven-busca" type="search" class="campo" placeholder="Buscar por cliente, imóvel ou telefone" value="${esc(this.busca)}" autocomplete="off">
        <select id="ven-situacao" class="campo">${opcoesSelect(SITUACOES_VENDA, this.situacao, 'Todas as situações')}</select>
        <select id="ven-tipo" class="campo">${opcoesSelect(TIPOS_CONDICAO, this.tipo, 'Todos os tipos')}</select>
        <select id="ven-corretor" class="campo">${opcoesSelect(corretores, this.corretor, 'Todos os corretores')}</select>
        <button class="botao botao-secundario" type="button" data-acao="ven-csv">Exportar CSV</button>
        <button class="botao botao-primario" type="button" data-acao="ven-nova">+ Nova venda</button>
      </div>
      <div class="cartao"><div id="ven-lista"></div></div>`;
    el('ven-busca').addEventListener('input', debounce((e) => { this.busca = e.target.value; this.pagina = 1; this.renderLista(); }, 200));
    ['situacao', 'tipo', 'corretor'].forEach((campo) => {
      el(`ven-${campo}`).addEventListener('change', (e) => { this[campo] = e.target.value; this.pagina = 1; this.renderLista(); });
    });
    raiz.querySelector('[data-acao="ven-csv"]').addEventListener('click', () => this.exportar());
    raiz.querySelector('[data-acao="ven-nova"]').addEventListener('click', () => this.abrirFormulario(null));
    raiz.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ven]');
      if (!b) return;
      const v = (dados.vendas || []).find((x) => x.id === b.dataset.id);
      if (!v) return;
      if (b.dataset.ven === 'editar') this.editar(v.id);
      else if (b.dataset.ven === 'excluir') this.excluir(v);
    });
    this.renderLista();
  },

  filtradas() {
    const termo = semAcento(this.busca.trim());
    const lista = (dados.vendas || []).filter((v) =>
      (!this.situacao || v.situacao === this.situacao) &&
      (!this.tipo || v.tipo_condicao === this.tipo) &&
      (!this.corretor || v.corretor === this.corretor) &&
      (!termo || semAcento([v.cliente_nome, v.imovel, v.cliente_telefone, v.id].join(' ')).includes(termo)));
    return ordenar(lista, this.ordem);
  },

  renderLista() {
    const alvo = el('ven-lista');
    if (!alvo) return;
    const lista = this.filtradas();
    if (!lista.length) { alvo.innerHTML = '<p class="vazio">Nenhuma venda encontrada.</p>'; return; }
    const { fatia, html: paginacao } = paginar(lista, this);
    alvo.innerHTML = `
      <div class="tabela-rolagem">
      <table class="tabela tabela-responsiva">
        <thead><tr>
          ${th('Cliente / imóvel', 'cliente_nome', this.ordem)}
          ${th('Entrada', 'valor_entrada', this.ordem, 'num')}
          ${th('Recebido', 'total_recebido', this.ordem, 'num')}
          ${th('Saldo', 'saldo', this.ordem, 'num')}
          ${th('Parcelas', 'parcelas_pagas', this.ordem)}
          ${th('Próx. venc.', 'proximo_vencimento', this.ordem)}
          ${th('Situação', 'situacao', this.ordem)}
          <th class="acoes"></th>
        </tr></thead>
        <tbody>${fatia.map((v) => `
          <tr class="${v.situacao === 'Em atraso' ? 'linha-atrasada' : ''}">
            <td class="principal-cel"><strong><a href="#/vendas/${esc(v.id)}">${esc(v.cliente_nome)}</a></strong><small>${esc(v.imovel)}${v.corretor ? ` · ${esc(v.corretor)}` : ''}</small></td>
            <td data-rotulo="Entrada" class="num">${esc(moeda(v.valor_entrada))}</td>
            <td data-rotulo="Recebido" class="num">${esc(moeda(v.total_recebido))}</td>
            <td data-rotulo="Saldo" class="num">${esc(moeda(v.saldo))}</td>
            <td data-rotulo="Parcelas" class="num">${v.parcelas_pagas}/${v.total_parcelas}</td>
            <td data-rotulo="Próx. venc." class="num">${esc(dataBr(v.proximo_vencimento))}</td>
            <td data-rotulo="Situação">${pilula(v.situacao, v.situacao === 'Em atraso' ? `Em atraso ${v.maior_atraso}d` : v.situacao)} ${v.conferencia_ok ? '' : pilula('Conferir', 'Conferir')}</td>
            <td class="acoes"><div class="botoes-linha" style="justify-content:flex-end">
              <a class="botao botao-secundario botao-pequeno" href="#/vendas/${esc(v.id)}">Abrir</a>
              <button class="botao botao-secundario botao-pequeno" type="button" data-ven="editar" data-id="${esc(v.id)}">Editar</button>
              <button class="botao botao-secundario botao-pequeno" type="button" data-ven="excluir" data-id="${esc(v.id)}" aria-label="Excluir venda">✕</button>
            </div></td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>${paginacao}`;
    ligarOrdenacao(alvo, this, () => this.renderLista());
  },

  // ───────────── Detalhe ─────────────

  async mostrarDetalhe(id) {
    const raiz = el('vista-venda');
    raiz.innerHTML = `<a class="voltar" href="#/vendas">‹ Vendas</a><div class="cartao">${skeleton(6, 40)}</div>`;
    const r = await api('getVenda', { id });
    dados.hoje = r.hoje;
    const v = r.venda;
    const percentual = v.valor_entrada > 0 ? Math.min(100, Math.round((v.total_recebido / v.valor_entrada) * 100)) : 0;
    const lista = v.parcelas.map((p) => Object.assign({}, p, { cliente_nome: v.cliente_nome, cliente_telefone: v.cliente_telefone, imovel: v.imovel, total_parcelas_venda: v.total_parcelas }));
    raiz.innerHTML = `
      <a class="voltar" href="#/vendas">‹ Vendas</a>
      <div class="detalhe-cabecalho">
        <div>
          <h2>${esc(v.cliente_nome)} <span class="nota" style="font-weight:400">${esc(v.id)}</span></h2>
          <p class="nota" style="margin-top:2px">${esc(v.imovel)}</p>
        </div>
        <div class="botoes-linha">
          ${pilula(v.situacao, v.situacao === 'Em atraso' ? `Em atraso há ${v.maior_atraso} dia${v.maior_atraso === 1 ? '' : 's'}` : v.situacao)}
          <button class="botao botao-secundario botao-pequeno" type="button" data-acao="det-editar">Editar venda</button>
          <button class="botao botao-secundario botao-pequeno" type="button" data-acao="det-excluir">Excluir</button>
        </div>
      </div>
      <div class="detalhe-grade">
        <div class="cartao">
          <div class="cartao-titulo"><h2>Cliente e imóvel</h2></div>
          <dl class="lista-dados">
            <dt>Cliente</dt><dd>${esc(v.cliente_nome)}</dd>
            <dt>WhatsApp</dt><dd>${v.cliente_telefone ? `<a href="https://wa.me/55${esc(v.cliente_telefone.replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(v.cliente_telefone)}</a>` : '—'}</dd>
            <dt>CPF</dt><dd>${esc(v.cliente_cpf || '—')}</dd>
            <dt>Imóvel</dt><dd>${esc(v.imovel)}</dd>
            <dt>Valor do imóvel</dt><dd class="num">${v.valor_imovel != null ? esc(moeda(v.valor_imovel)) : '—'}</dd>
            <dt>Condição</dt><dd>${esc(v.tipo_condicao)} · ${v.num_parcelas}x ${esc(v.periodicidade.toLowerCase())}</dd>
            <dt>1º vencimento</dt><dd class="num">${esc(dataBr(v.primeiro_vencimento))}</dd>
            <dt>Corretor(a)</dt><dd>${esc(v.corretor || '—')}</dd>
            ${v.observacoes ? `<dt>Observações</dt><dd>${esc(v.observacoes)}</dd>` : ''}
            <dt>Cadastro</dt><dd class="nota" style="margin:0">${esc(dataHoraBr(v.criado_em))} por ${esc(v.criado_por)}${v.atualizado_em && v.atualizado_em !== v.criado_em ? `<br>editado ${esc(dataHoraBr(v.atualizado_em))} por ${esc(v.atualizado_por)}` : ''}</dd>
          </dl>
        </div>
        <div class="cartao">
          <div class="cartao-titulo"><h2>Resumo financeiro</h2><span class="nota" style="margin:0">${percentual}% recebido</span></div>
          <div class="progresso"><span style="width:${percentual}%"></span></div>
          <div class="resumo-financeiro">
            <div><div class="rotulo-card">Entrada</div><div class="valor-card">${esc(moeda(v.valor_entrada))}</div></div>
            <div><div class="rotulo-card">Recebido</div><div class="valor-card" style="color:var(--verde)">${esc(moeda(v.total_recebido))}</div></div>
            <div><div class="rotulo-card">Saldo</div><div class="valor-card" ${v.saldo > 0 && v.situacao === 'Em atraso' ? 'style="color:var(--vermelho)"' : ''}>${esc(moeda(v.saldo))}</div></div>
          </div>
          <p class="nota">Parcelas pagas: <strong>${v.parcelas_pagas}/${v.total_parcelas}</strong> · próximo vencimento: <strong>${esc(dataBr(v.proximo_vencimento))}</strong></p>
          ${v.conferencia_ok ? '' : `<div class="alerta alerta-roxo">⚠ Parcelas não batem com o valor da entrada: somam ${esc(moeda(v.soma_parcelas))} e a entrada é ${esc(moeda(v.valor_entrada))}.</div>`}
        </div>
      </div>
      <div class="cartao" style="margin-top:16px">
        <div class="cartao-titulo"><h2>Parcelas</h2><button class="botao botao-secundario botao-pequeno" type="button" data-acao="det-nova-parcela">+ Parcela avulsa</button></div>
        <div class="tabela-rolagem">
        <table class="tabela tabela-responsiva">
          <thead><tr><th>Parcela</th><th class="num">Valor</th><th>Vencimento</th><th>Situação</th><th>Pagamento</th><th class="acoes"></th></tr></thead>
          <tbody>${lista.length ? lista.map((p) => `
            <tr class="${p.situacao === 'Atrasado' ? 'linha-atrasada' : ''}">
              <td class="principal-cel"><strong>Parcela ${p.numero}/${v.total_parcelas}</strong>${p.observacoes ? `<small>${esc(p.observacoes)}</small>` : ''}</td>
              <td data-rotulo="Valor" class="num"><span class="pilha">${esc(moeda(p.valor))}${p.status === 'Pago' && p.valor_pago != null && Math.abs(p.valor_pago - p.valor) > 0.005 ? `<small class="nota">pago ${esc(moeda(p.valor_pago))}</small>` : ''}</span></td>
              <td data-rotulo="Vencimento" class="num">${esc(dataBr(p.vencimento))}</td>
              <td data-rotulo="Situação">${pilula(p.situacao, p.situacao === 'Atrasado' ? `Atrasado ${p.dias_atraso}d` : p.situacao)}</td>
              <td data-rotulo="Pagamento" class="num">${p.status === 'Pago' ? `<span class="pilha">${esc(dataBr(p.data_pagamento))}<small class="nota">${esc(p.forma_pagamento)}</small></span>` : '—'}</td>
              <td class="acoes">${parcelas.botoesLinha(p)}</td>
            </tr>`).join('') : '<tr><td colspan="6" class="vazio">Nenhuma parcela cadastrada.</td></tr>'}
          </tbody>
        </table>
        </div>
      </div>`;
    raiz.querySelector('[data-acao="det-editar"]').addEventListener('click', () => this.abrirFormulario(v));
    raiz.querySelector('[data-acao="det-excluir"]').addEventListener('click', () => this.excluir(v));
    raiz.querySelector('[data-acao="det-nova-parcela"]').addEventListener('click', () => parcelas.abrirFormulario(v.id, null));
    raiz.addEventListener('click', (e) => parcelas.tratarClique(e, lista));
  },

  async editar(id) {
    try {
      const r = await api('getVenda', { id });
      this.abrirFormulario(r.venda);
    } catch (erro) {
      if (erro.codigo !== 'SESSAO') toast(erro.message, 'erro');
    }
  },

  async excluir(v) {
    const ok = await confirmar('Excluir venda', `Excluir a venda de <strong>${esc(v.cliente_nome)}</strong> (${esc(v.imovel)}) e todas as suas parcelas? Os registros ficam guardados na planilha como inativos e aparecem no histórico.`, { ok: 'Excluir venda', perigo: true });
    if (!ok) return;
    await executarEscrita(null, 'deleteVenda', { id: v.id }, 'Venda excluída.').then(() => {
      if (app.rotaAtual === 'venda') location.hash = '#/vendas';
    }).catch(() => {});
  },

  // ───────────── Formulário com prévia das parcelas ─────────────

  abrirFormulario(v) {
    const editando = !!v;
    const pagas = editando ? v.parcelas.filter((p) => p.status === 'Pago') : [];
    const hoje = dados.hoje || hojeIso();
    abrirModal(editando ? `Editar venda ${v.id}` : 'Nova venda', `
      <form id="form-venda" novalidate>
        <div class="form-grade">
          <label class="rotulo col-2">Nome do cliente *<input name="cliente_nome" class="campo" value="${esc(editando ? v.cliente_nome : '')}" maxlength="120" required></label>
          <label class="rotulo">WhatsApp<input name="cliente_telefone" class="campo" inputmode="tel" placeholder="(64) 99999-9999" value="${esc(editando ? v.cliente_telefone : '')}"></label>
          <label class="rotulo">CPF<input name="cliente_cpf" class="campo" inputmode="numeric" placeholder="000.000.000-00" value="${esc(editando ? v.cliente_cpf : '')}"></label>
          <label class="rotulo col-2">Imóvel comprado *<input name="imovel" class="campo" value="${esc(editando ? v.imovel : '')}" maxlength="200" placeholder="Ex.: Apto 204 – Ed. Solar, Casa Qd. 12 Lt. 08" required></label>
          <label class="rotulo">Valor do imóvel (R$)<input name="valor_imovel" class="campo campo-moeda" inputmode="decimal" value="${esc(editando ? moedaCampo(v.valor_imovel) : '')}"></label>
          <label class="rotulo">Corretor(a)<input name="corretor" class="campo" value="${esc(editando ? v.corretor : '')}" maxlength="80" list="lista-corretores"></label>
          <datalist id="lista-corretores">${Array.from(new Set((dados.vendas || []).map((x) => x.corretor).filter(Boolean))).map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        </div>
        <div class="form-secao">
          <h3>Condição de pagamento</h3>
          <div class="form-grade">
            <label class="rotulo">Tipo *<select name="tipo_condicao" class="campo">${opcoesSelect(TIPOS_CONDICAO, editando ? v.tipo_condicao : 'Entrada parcelada')}</select></label>
            <label class="rotulo">Valor da entrada (R$) *<input name="valor_entrada" class="campo campo-moeda" inputmode="decimal" value="${esc(editando ? moedaCampo(v.valor_entrada) : '')}" required></label>
            <label class="rotulo">Nº de parcelas *<input name="num_parcelas" class="campo" type="number" min="1" max="240" step="1" value="${esc(editando ? v.num_parcelas : 1)}" required></label>
            <label class="rotulo">1º vencimento *<input name="primeiro_vencimento" class="campo" type="date" value="${esc(editando ? v.primeiro_vencimento : '')}" required></label>
            <label class="rotulo">Periodicidade<select name="periodicidade" class="campo">${opcoesSelect(PERIODICIDADES, editando ? v.periodicidade : 'Mensal')}</select></label>
            <label class="rotulo col-2">Observações<textarea name="observacoes" class="campo" maxlength="1000">${esc(editando ? v.observacoes : '')}</textarea></label>
          </div>
        </div>
        <div class="form-secao">
          <h3>Prévia das parcelas <button class="botao botao-secundario botao-pequeno" type="button" data-acao="previa-gerar">Recalcular parcelas</button></h3>
          ${pagas.length ? `<div class="alerta alerta-ambar" style="margin:0 0 10px">Esta venda já tem ${pagas.length} parcela(s) paga(s). Elas não mudam: o recálculo só redistribui o que falta entre as parcelas em aberto.</div>` : ''}
          <div id="previa"></div>
        </div>
        <p id="venda-erro" class="erro-campo" hidden></p>
        <div class="modal-botoes">
          <button class="botao botao-secundario" type="button" data-acao="fechar-modal">Cancelar</button>
          <button class="botao botao-primario" type="submit">${editando ? 'Salvar alterações' : 'Cadastrar venda'}</button>
        </div>
      </form>`, { larga: true });

    const f = el('form-venda');
    let previa = editando ? v.parcelas.map((p) => ({ id: p.id, numero: p.numero, valor: p.valor, vencimento: p.vencimento, status: p.status, observacoes: p.observacoes })) : [];

    const renderPrevia = () => {
      const entrada = lerMoeda(f.valor_entrada.value) || 0;
      const soma = centavos(previa.reduce((s, p) => s + (Number(p.valor) || 0), 0));
      const bate = Math.abs(soma - entrada) < 0.005;
      const personalizada = f.periodicidade.value === 'Personalizada';
      el('previa').innerHTML = previa.length ? `
        <div class="tabela-rolagem"><table class="tabela previa-tabela">
          <thead><tr><th>Nº</th><th>Valor (R$)</th><th>Vencimento</th><th>Status</th></tr></thead>
          <tbody>${previa.map((p, i) => p.status === 'Pago' ? `
            <tr><td class="num">${p.numero}</td><td class="num">${esc(moeda(p.valor))}</td><td class="num">${esc(dataBr(p.vencimento))}</td><td>${pilula('Pago')}</td></tr>` : `
            <tr>
              <td class="num">${p.numero}</td>
              <td><input class="campo campo-moeda" data-previa="valor" data-i="${i}" inputmode="decimal" value="${esc(moedaCampo(p.valor))}"></td>
              <td><input class="campo" data-previa="vencimento" data-i="${i}" type="date" value="${esc(p.vencimento)}" ${personalizada && !p.vencimento ? 'placeholder="preencha"' : ''}></td>
              <td>${pilula('A pagar')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="previa-total ${bate ? 'ok' : 'erro'}">
          <span>Soma das parcelas: <strong>${esc(moeda(soma))}</strong> · entrada: <strong>${esc(moeda(entrada))}</strong></span>
          <span>${bate ? '✓ Parcelas batem com a entrada' : '⚠ Parcelas não batem com o valor da entrada'}</span>
        </div>` : `<p class="nota">Preencha o valor da entrada, o nº de parcelas e o 1º vencimento para ver a prévia.</p>`;
    };

    const gerar = () => {
      const entrada = lerMoeda(f.valor_entrada.value);
      const n = Number(f.num_parcelas.value);
      const primeiro = f.primeiro_vencimento.value;
      const periodicidade = f.periodicidade.value;
      if (!entrada || entrada <= 0 || !Number.isInteger(n) || n < 1 || (!dataValida(primeiro) && periodicidade !== 'Personalizada')) { renderPrevia(); return; }
      const abertasQtd = Math.max(0, n - pagas.length);
      const somaPagas = centavos(pagas.reduce((s, p) => s + p.valor, 0));
      const restante = centavos(entrada - somaPagas);
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
      renderPrevia();
    };

    // Máscaras e regras de formulário
    f.cliente_telefone.addEventListener('input', (e) => { e.target.value = mascaraTelefone(e.target.value); });
    f.cliente_cpf.addEventListener('input', (e) => { e.target.value = mascaraCpf(e.target.value); });
    f.tipo_condicao.addEventListener('change', () => {
      if (f.tipo_condicao.value === 'Entrada a prazo') { f.num_parcelas.value = 1; }
      gerar();
    });
    // Regera a prévia ao mudar os campos que a definem (no change e, com atraso, ao digitar).
    const gerarComAtraso = debounce(gerar, 400);
    ['valor_entrada', 'num_parcelas', 'primeiro_vencimento', 'periodicidade'].forEach((campo) => {
      f[campo].addEventListener('change', gerar);
      f[campo].addEventListener('input', gerarComAtraso);
    });
    f.querySelector('[data-acao="previa-gerar"]').addEventListener('click', gerar);
    el('previa').addEventListener('input', (e) => {
      const inp = e.target.closest('[data-previa]');
      if (!inp) return;
      const p = previa[Number(inp.dataset.i)];
      if (inp.dataset.previa === 'valor') p.valor = lerMoeda(inp.value) || 0;
      else p.vencimento = inp.value;
      // Atualiza só a linha de total, sem redesenhar os inputs (para não perder o foco).
      const entrada = lerMoeda(f.valor_entrada.value) || 0;
      const soma = centavos(previa.reduce((s, x) => s + (Number(x.valor) || 0), 0));
      const total = el('previa').querySelector('.previa-total');
      if (total) {
        const bate = Math.abs(soma - entrada) < 0.005;
        total.className = `previa-total ${bate ? 'ok' : 'erro'}`;
        total.innerHTML = `<span>Soma das parcelas: <strong>${esc(moeda(soma))}</strong> · entrada: <strong>${esc(moeda(entrada))}</strong></span><span>${bate ? '✓ Parcelas batem com a entrada' : '⚠ Parcelas não batem com o valor da entrada'}</span>`;
      }
    });
    if (editando) renderPrevia(); else gerar();

    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const erro = el('venda-erro');
      const campos = {
        id: editando ? v.id : '',
        cliente_nome: f.cliente_nome.value.trim(),
        cliente_telefone: f.cliente_telefone.value.trim(),
        cliente_cpf: f.cliente_cpf.value.trim(),
        imovel: f.imovel.value.trim(),
        valor_imovel: f.valor_imovel.value.trim() ? lerMoeda(f.valor_imovel.value) : null,
        tipo_condicao: f.tipo_condicao.value,
        valor_entrada: lerMoeda(f.valor_entrada.value),
        num_parcelas: Number(f.num_parcelas.value),
        primeiro_vencimento: f.primeiro_vencimento.value,
        periodicidade: f.periodicidade.value,
        corretor: f.corretor.value.trim(),
        observacoes: f.observacoes.value.trim(),
      };
      qa('.campo-erro', f).forEach((c) => c.classList.remove('campo-erro'));
      const falhar = (campo, msg) => { if (campo) f[campo].classList.add('campo-erro'); mostrarErro(erro, msg); };
      if (!campos.cliente_nome) return falhar('cliente_nome', 'Informe o nome do cliente.');
      if (!campos.imovel) return falhar('imovel', 'Informe o imóvel comprado.');
      if (campos.valor_entrada === null || campos.valor_entrada <= 0) return falhar('valor_entrada', 'O valor da entrada precisa ser maior que zero.');
      if (campos.valor_imovel !== null && (!Number.isFinite(campos.valor_imovel) || campos.valor_imovel < 0)) return falhar('valor_imovel', 'Valor do imóvel inválido.');
      if (!Number.isInteger(campos.num_parcelas) || campos.num_parcelas < 1) return falhar('num_parcelas', 'O nº de parcelas precisa ser um inteiro a partir de 1.');
      if (!dataValida(campos.primeiro_vencimento)) return falhar('primeiro_vencimento', 'Informe o 1º vencimento.');
      if (!previa.length) return falhar(null, 'Gere a prévia das parcelas antes de salvar.');
      for (const p of previa) {
        if (p.status === 'Pago') continue;
        if (!(Number(p.valor) > 0)) return falhar(null, `A parcela ${p.numero} precisa ter valor maior que zero.`);
        if (!dataValida(p.vencimento)) return falhar(null, `Informe o vencimento da parcela ${p.numero}.`);
      }
      const soma = centavos(previa.reduce((s, p) => s + Number(p.valor), 0));
      if (Math.abs(soma - campos.valor_entrada) >= 0.005) {
        const seguir = await confirmar('Parcelas não batem', `As parcelas somam <strong>${esc(moeda(soma))}</strong> e a entrada é <strong>${esc(moeda(campos.valor_entrada))}</strong>. Salvar mesmo assim? A venda ficará marcada como "Conferir".`, { ok: 'Salvar assim mesmo' });
        if (!seguir) return;
      }
      erro.hidden = true;
      campos.parcelas = previa.map((p) => ({ id: p.id || '', numero: p.numero, valor: Number(p.valor), vencimento: p.vencimento, observacoes: p.observacoes || '' }));
      await this.salvar(f, campos, editando);
    });
  },

  async salvar(f, campos, editando) {
    const botao = f && f.isConnected ? f.querySelector('[type=submit]') : null;
    try {
      await executarEscrita(botao, 'saveVenda', campos, editando ? 'Venda atualizada.' : `Venda cadastrada com ${campos.parcelas.length} parcela(s).`);
    } catch (erro) {
      if (erro.codigo === 'CONFIRMAR') {
        const ok = await confirmar('Recalcular parcelas em aberto', `${esc(erro.message)}<br><br>As parcelas pagas continuam exatamente como estão.`, { ok: 'Confirmar e salvar' });
        if (ok) await executarEscrita(null, 'saveVenda', Object.assign({ confirmarRecalculo: true }, campos), 'Venda atualizada.').catch(() => {});
      }
    }
  },

  exportar() {
    exportarCsv('vendas', [
      { rotulo: 'ID', valor: (v) => v.id },
      { rotulo: 'Cliente', valor: (v) => v.cliente_nome },
      { rotulo: 'Telefone', valor: (v) => v.cliente_telefone },
      { rotulo: 'CPF', valor: (v) => v.cliente_cpf },
      { rotulo: 'Imóvel', valor: (v) => v.imovel },
      { rotulo: 'Valor do imóvel', valor: (v) => moedaCampo(v.valor_imovel) },
      { rotulo: 'Tipo', valor: (v) => v.tipo_condicao },
      { rotulo: 'Entrada', valor: (v) => moedaCampo(v.valor_entrada) },
      { rotulo: 'Parcelas', valor: (v) => `${v.parcelas_pagas}/${v.total_parcelas}` },
      { rotulo: '1º vencimento', valor: (v) => dataBr(v.primeiro_vencimento) },
      { rotulo: 'Periodicidade', valor: (v) => v.periodicidade },
      { rotulo: 'Corretor', valor: (v) => v.corretor },
      { rotulo: 'Recebido', valor: (v) => moedaCampo(v.total_recebido) },
      { rotulo: 'Saldo', valor: (v) => moedaCampo(v.saldo) },
      { rotulo: 'Próximo vencimento', valor: (v) => dataBr(v.proximo_vencimento) },
      { rotulo: 'Situação', valor: (v) => v.situacao },
      { rotulo: 'Conferência', valor: (v) => (v.conferencia_ok ? 'OK' : 'Parcelas não batem') },
      { rotulo: 'Observações', valor: (v) => v.observacoes },
    ], this.filtradas());
  },
};

/**
 * Mesma regra do backend: divide igualmente e ajusta a diferença de centavos na última.
 * `deslocamento` numera as parcelas a partir das já pagas (ex.: 2 pagas → começa em 3).
 */
function gerarParcelas(valorTotal, quantidade, primeiroVencimento, periodicidade, deslocamento = 0) {
  const base = Math.floor((valorTotal * 100) / quantidade) / 100;
  const lista = [];
  for (let i = 0; i < quantidade; i++) {
    let vencimento = '';
    if (periodicidade === 'Quinzenal' && primeiroVencimento) vencimento = somarDias(primeiroVencimento, 15 * i);
    else if (periodicidade === 'Mensal' && primeiroVencimento) vencimento = somarMeses(primeiroVencimento, i);
    lista.push({ numero: deslocamento + i + 1, valor: base, vencimento });
  }
  lista[quantidade - 1].valor = centavos(base + (valorTotal - centavos(base * quantidade)));
  return lista;
}
