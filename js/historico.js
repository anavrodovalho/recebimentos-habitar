'use strict';
/**
 * historico.js — tela com o db_log (quem fez o quê e quando).
 */

const ROTULO_ACAO = {
  criar: 'Criou', editar: 'Editou', excluir: 'Excluiu', baixa: 'Deu baixa', estorno: 'Estornou', setup: 'Configurou',
};
const ROTULO_ENTIDADE = { venda: 'venda', parcela: 'parcela', usuario: 'usuário', banco: 'banco' };

const historico = {
  busca: '',
  acao: '',

  async mostrar() {
    const raiz = el('vista-historico');
    raiz.innerHTML = `
      <div class="barra-ferramentas">
        <input id="hist-busca" type="search" class="campo" placeholder="Buscar por usuário, registro ou descrição" value="${esc(this.busca)}" autocomplete="off">
        <select id="hist-acao" class="campo">${opcoesSelect(Object.keys(ROTULO_ACAO).map((k) => ({ valor: k, rotulo: ROTULO_ACAO[k] })), this.acao, 'Todas as ações')}</select>
        <button class="botao botao-secundario" type="button" data-acao="hist-csv">Exportar CSV</button>
      </div>
      <div id="hist-lista" class="cartao">${skeleton(8, 40)}</div>`;
    el('hist-busca').addEventListener('input', debounce((e) => { this.busca = e.target.value; this.render(); }, 200));
    el('hist-acao').addEventListener('change', (e) => { this.acao = e.target.value; this.render(); });
    raiz.querySelector('[data-acao="hist-csv"]').addEventListener('click', () => this.exportar());
    await dados.carregarLog();
    this.render();
  },

  filtrados() {
    const termo = semAcento(this.busca.trim());
    return (dados.log || []).filter((l) => (!this.acao || l.acao === this.acao) &&
      (!termo || semAcento([l.usuario, l.registro_id, l.resumo_alteracao, l.entidade].join(' ')).includes(termo)));
  },

  render() {
    const alvo = el('hist-lista');
    if (!alvo) return;
    const lista = this.filtrados();
    if (!lista.length) { alvo.innerHTML = '<p class="vazio">Nenhum registro encontrado.</p>'; return; }
    alvo.innerHTML = `
      <table class="tabela tabela-responsiva">
        <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Registro</th><th>Detalhes</th></tr></thead>
        <tbody>${lista.slice(0, 500).map((l) => `
          <tr>
            <td data-rotulo="Quando" class="num">${esc(dataHoraBr(l.data_hora))}</td>
            <td data-rotulo="Quem">${esc(l.usuario)}</td>
            <td data-rotulo="O quê"><span class="pilula ${classeAcao(l.acao)}">${esc(ROTULO_ACAO[l.acao] || l.acao)}</span> ${esc(ROTULO_ENTIDADE[l.entidade] || l.entidade)}</td>
            <td data-rotulo="Registro">${l.entidade === 'venda' && l.registro_id ? `<a href="#/vendas/${esc(l.registro_id)}">${esc(l.registro_id)}</a>` : esc(l.registro_id)}</td>
            <td data-rotulo="Detalhes" class="quebra">${esc(l.resumo_alteracao)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${lista.length > 500 ? '<p class="nota">Mostrando os 500 registros mais recentes.</p>' : ''}`;
  },

  exportar() {
    exportarCsv('historico', [
      { rotulo: 'Data/hora', valor: (l) => dataHoraBr(l.data_hora) },
      { rotulo: 'Usuário', valor: (l) => l.usuario },
      { rotulo: 'Ação', valor: (l) => ROTULO_ACAO[l.acao] || l.acao },
      { rotulo: 'Entidade', valor: (l) => l.entidade },
      { rotulo: 'Registro', valor: (l) => l.registro_id },
      { rotulo: 'Detalhes', valor: (l) => l.resumo_alteracao },
    ], this.filtrados());
  },
};

function classeAcao(acao) {
  return { criar: 'st-vencer', editar: 'st-neutro', excluir: 'st-atrasado', baixa: 'st-pago', estorno: 'st-breve', setup: 'st-conferir' }[acao] || 'st-neutro';
}
