'use strict';
/**
 * app.js — inicialização, login, navegação (hash), cache de dados, modal e toasts.
 * Os módulos painel/vendas/parcelas/historico renderizam dentro das <section id="vista-*">.
 */

const TITULOS = { painel: 'Painel', vendas: 'Vendas', venda: 'Detalhe da venda', parcelas: 'Parcelas', historico: 'Histórico' };

/** Cache dos dados vindos da API. Cada escrita chama dados.invalidar(). */
const dados = {
  dashboard: null, vendas: null, parcelas: null, log: null, hoje: hojeIso(),
  invalidar() { this.dashboard = null; this.vendas = null; this.parcelas = null; this.log = null; },
  async carregarDashboard(forcar) {
    if (!this.dashboard || forcar) { this.dashboard = await api('getDashboard'); this.hoje = this.dashboard.hoje; }
    return this.dashboard;
  },
  async carregarVendas(forcar) {
    if (!this.vendas || forcar) { const r = await api('listVendas'); this.vendas = r.vendas; this.hoje = r.hoje; }
    return this.vendas;
  },
  async carregarParcelas(forcar) {
    if (!this.parcelas || forcar) { const r = await api('listParcelas'); this.parcelas = r.parcelas; this.hoje = r.hoje; }
    return this.parcelas;
  },
  async carregarLog(forcar) {
    if (!this.log || forcar) this.log = await api('listLog', { limite: 1000 });
    return this.log;
  },
};

const app = {
  rotaAtual: null,

  iniciar() {
    sessao.carregar();
    el('form-login').addEventListener('submit', (e) => { e.preventDefault(); this.entrar(); });
    document.addEventListener('click', (e) => this.cliqueGlobal(e));
    document.addEventListener('sessao-expirada', () => { toast('Sua sessão expirou. Entre de novo.', 'erro'); this.mostrarLogin(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el('modal').hidden) fecharModal(); });
    window.addEventListener('hashchange', () => this.navegar());
    if (sessao.dados) this.mostrarApp(); else this.mostrarLogin();
  },

  cliqueGlobal(e) {
    const alvo = e.target.closest('[data-acao]');
    if (!alvo) return;
    const acao = alvo.dataset.acao;
    if (acao === 'sair') this.sair();
    else if (acao === 'fechar-modal') fecharModal();
    else if (acao === 'atualizar') this.atualizar();
  },

  mostrarLogin() {
    el('tela-app').hidden = true;
    el('tela-login').hidden = false;
    el('login-aviso').hidden = true;
    setTimeout(() => el('login-usuario').focus(), 50);
  },

  async entrar() {
    const usuario = el('login-usuario').value.trim();
    const senha = el('login-senha').value;
    const aviso = el('login-aviso');
    aviso.hidden = true;
    if (!usuario || !senha) { aviso.textContent = 'Informe o usuário e a senha.'; aviso.hidden = false; return; }
    const botao = el('login-botao');
    botao.disabled = true; botao.textContent = 'Entrando…';
    try {
      const s = await api('login', { usuario, senha });
      sessao.guardar(s);
      el('login-senha').value = '';
      this.mostrarApp();
    } catch (erro) {
      aviso.textContent = erro.message; aviso.hidden = false;
    } finally {
      botao.disabled = false; botao.textContent = 'Entrar';
    }
  },

  mostrarApp() {
    const s = sessao.dados;
    const iniciais = s.nome.split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
    el('menu-nome').textContent = s.nome;
    el('topo-nome').textContent = s.nome;
    el('menu-avatar').textContent = iniciais;
    el('topo-avatar').textContent = iniciais;
    el('tela-login').hidden = true;
    el('tela-app').hidden = false;
    dados.invalidar();
    if (!location.hash) location.hash = '#/painel';
    this.navegar();
  },

  async sair() {
    try { await api('logout'); } catch (e) { /* o token some de qualquer jeito */ }
    sessao.limpar();
    dados.invalidar();
    fecharModal();
    this.mostrarLogin();
  },

  async atualizar() {
    dados.invalidar();
    toast('Atualizando…', 'info', 1200);
    await this.navegar();
  },

  /** Rotas: #/painel · #/vendas · #/vendas/V0001 · #/parcelas · #/historico */
  async navegar() {
    if (!sessao.dados) return;
    const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    let rota = partes[0] || 'painel';
    let parametro = partes[1] || null;
    if (!TITULOS[rota]) { rota = 'painel'; parametro = null; }
    if (rota === 'vendas' && parametro) rota = 'venda';

    qa('.vista').forEach((v) => { v.hidden = true; });
    qa('[data-rota]').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === (rota === 'venda' ? 'vendas' : rota)));
    el('topo-titulo').textContent = TITULOS[rota];
    document.title = `${TITULOS[rota]} · Recebimentos Habitar`;
    const vista = el(`vista-${rota}`);
    vista.hidden = false;
    this.rotaAtual = rota;
    window.scrollTo(0, 0);

    try {
      if (rota === 'painel') await painel.mostrar();
      else if (rota === 'vendas') await vendas.mostrar();
      else if (rota === 'venda') await vendas.mostrarDetalhe(parametro);
      else if (rota === 'parcelas') await parcelas.mostrar();
      else if (rota === 'historico') await historico.mostrar();
    } catch (erro) {
      if (erro.codigo !== 'SESSAO') {
        vista.innerHTML = `<div class="cartao aviso-erro-bloco"><p>${esc(erro.message)}</p><button class="botao botao-secundario" type="button" data-acao="atualizar">Tentar de novo</button></div>`;
      }
    }
  },

  /** Recarrega a tela atual depois de uma escrita. */
  async recarregar() {
    dados.invalidar();
    await this.navegar();
  },
};

// ───────────────────────────── Modal e confirmação ─────────────────────────────

function abrirModal(titulo, html, opcoes = {}) {
  const modal = el('modal');
  el('modal-titulo').textContent = titulo;
  el('modal-corpo').innerHTML = html;
  modal.querySelector('.modal-caixa').classList.toggle('modal-larga', !!opcoes.larga);
  modal.hidden = false;
  document.body.classList.add('sem-rolagem');
  const primeiro = modal.querySelector('input:not([type=hidden]):not([readonly]), select, textarea, button.botao-primario');
  if (primeiro) setTimeout(() => primeiro.focus(), 30);
}

function fecharModal() {
  const modal = el('modal');
  if (modal.hidden) return;
  modal.hidden = true;
  el('modal-corpo').innerHTML = '';
  document.body.classList.remove('sem-rolagem');
}

/**
 * Diálogo de confirmação. Resolve true/false.
 * Usa um elemento próprio, por cima do modal, para um formulário aberto não se perder.
 */
function confirmar(titulo, mensagem, opcoes = {}) {
  return new Promise((resolve) => {
    const dialogo = el('dialogo-confirma');
    dialogo.querySelector('.modal-caixa').innerHTML = `
      <header class="modal-topo"><h2>${esc(titulo)}</h2></header>
      <div class="modal-corpo">
        <p class="modal-texto">${mensagem}</p>
        <div class="modal-botoes">
          <button class="botao botao-secundario" type="button" data-conf="nao">${esc(opcoes.cancelar || 'Cancelar')}</button>
          <button class="botao ${opcoes.perigo ? 'botao-perigo' : 'botao-primario'}" type="button" data-conf="sim">${esc(opcoes.ok || 'Confirmar')}</button>
        </div>
      </div>`;
    dialogo.hidden = false;
    document.body.classList.add('sem-rolagem');
    dialogo.querySelector('[data-conf="sim"]').focus();
    const fechar = (resultado) => {
      dialogo.hidden = true;
      dialogo.querySelector('.modal-caixa').innerHTML = '';
      if (el('modal').hidden) document.body.classList.remove('sem-rolagem');
      document.removeEventListener('keydown', aoTeclar);
      resolve(resultado);
    };
    const aoTeclar = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(false); } };
    document.addEventListener('keydown', aoTeclar, true);
    dialogo.onclick = (e) => {
      const b = e.target.closest('[data-conf]');
      if (b) fechar(b.dataset.conf === 'sim');
      else if (e.target.classList.contains('modal-fundo')) fechar(false);
    };
  });
}

// ───────────────────────────── Toasts ─────────────────────────────

function toast(mensagem, tipo = 'sucesso', duracao = 3500) {
  const caixa = document.createElement('div');
  caixa.className = `toast toast-${tipo}`;
  caixa.textContent = mensagem;
  el('toasts').appendChild(caixa);
  requestAnimationFrame(() => caixa.classList.add('visivel'));
  setTimeout(() => { caixa.classList.remove('visivel'); setTimeout(() => caixa.remove(), 300); }, duracao);
}

/** Executa uma escrita com botão travado, toast de resultado e recarga da tela. */
async function executarEscrita(botao, acao, payload, mensagemSucesso) {
  const textoOriginal = botao ? botao.textContent : '';
  if (botao) { botao.disabled = true; botao.textContent = 'Salvando…'; }
  try {
    const r = await api(acao, payload);
    fecharModal();
    toast(mensagemSucesso);
    await app.recarregar();
    return r;
  } catch (erro) {
    // CONFIRMAR não é erro: quem chamou abre o diálogo de confirmação.
    if (erro.codigo !== 'SESSAO' && erro.codigo !== 'CONFIRMAR') toast(erro.message, 'erro', 5000);
    throw erro;
  } finally {
    if (botao) { botao.disabled = false; botao.textContent = textoOriginal; }
  }
}

document.addEventListener('DOMContentLoaded', () => app.iniciar());
