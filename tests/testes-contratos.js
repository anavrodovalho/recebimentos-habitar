'use strict';
/**
 * Testes de Pagamentos e Empréstimos no simulador do Apps Script.
 * Rode: node tests/testes-contratos.js
 */
const assert = require('assert');
const { criarAmbiente, abasAntigas } = require('./simulador');

let passaram = 0;
function teste(nome, fn) {
  try { fn(); passaram++; console.log('  ✔', nome); }
  catch (e) { console.log('  ✘', nome, '\n     ', e.message); process.exitCode = 1; }
}
const ok = (r, msg) => { assert.strictEqual(r.ok, true, (msg || 'resposta') + ': ' + r.error); return r.data; };
const erro = (r, trecho) => { assert.strictEqual(r.ok, false, 'esperava erro'); if (trecho) assert.ok(r.error.includes(trecho) || r.code === trecho, `erro "${r.error}" (code ${r.code}) não contém "${trecho}"`); return r; };

const amb = criarAmbiente({ abas: abasAntigas(), agora: '2026-11-13T15:00:00-03:00', silencioso: true });
amb.rodar('setupDatabase');
// Simula uma planilha instalada antes desta versão: sem as abas novas.
amb.ss.sheets = amb.ss.sheets.filter((a) => a.name !== 'db_pagamentos' && a.name !== 'db_emprestimos');
amb.rodar('criarUsuario', 'ana', 'Ana Laura', 'segredo123');
const t = ok(amb.chamar('login', { usuario: 'ana', senha: 'segredo123' })).token;
let idPg, idEm;

console.log('\nPagamentos e empréstimos');
teste('abas novas são criadas sozinhas no primeiro uso', () => {
  const r = ok(amb.chamar('listContratos', { tipo: 'pagamento' }, t));
  assert.deepStrictEqual(r.registros, []);
  assert.ok(amb.ss.getSheetByName('db_pagamentos'));
  ok(amb.chamar('listContratos', { tipo: 'emprestimo' }, t));
  assert.ok(amb.ss.getSheetByName('db_emprestimos'));
  erro(amb.chamar('listContratos', { tipo: 'outro' }, t), 'inválido');
  erro(amb.chamar('listContratos', { tipo: 'pagamento' }), 'SESSAO');
});

teste('cadastra pagamento em 3x com ajuste de centavos', () => {
  idPg = ok(amb.chamar('saveContrato', { tipo: 'pagamento', favorecido: 'Gráfica Central', descricao: 'Placas de venda', categoria: 'Marketing',
    valor_total: 1000, num_parcelas: 3, primeiro_vencimento: '2026-11-10', periodicidade: 'Mensal' }, t)).id;
  assert.strictEqual(idPg, 'PG0001');
  const r = ok(amb.chamar('getContrato', { tipo: 'pagamento', id: idPg }, t)).registro;
  assert.deepStrictEqual(r.parcelas.map((p) => p.valor), [333.33, 333.33, 333.34]);
  assert.strictEqual(r.parcelas[0].situacao, 'Atrasado');
  assert.strictEqual(r.situacao, 'Em atraso');
  assert.strictEqual(r.saldo, 1000);
  assert.strictEqual(r.conferencia_ok, true);
  const bruto = amb.ss.getSheetByName('db_parcelas').getDataRange().getValues().filter((l) => l[1] === idPg);
  assert.strictEqual(bruto.length, 3);
  const linha = amb.ss.getSheetByName('db_pagamentos').getDataRange().getValues()[1];
  assert.strictEqual(linha[6], '2026-11-10'); // data como texto
});

teste('validação de pagamento', () => {
  erro(amb.chamar('saveContrato', { tipo: 'pagamento', descricao: 'x', valor_total: 10, num_parcelas: 1, primeiro_vencimento: '2026-12-01' }, t), 'favorecido');
  erro(amb.chamar('saveContrato', { tipo: 'pagamento', favorecido: 'x', descricao: 'x', valor_total: 0, num_parcelas: 1, primeiro_vencimento: '2026-12-01' }, t), 'maior que zero');
  erro(amb.chamar('saveContrato', { tipo: 'pagamento', favorecido: 'x', descricao: 'x', valor_total: 5, num_parcelas: 1, primeiro_vencimento: '2026-02-31' }, t), 'data válida');
});

teste('cadastra empréstimo com juros (valor a receber maior que o emprestado)', () => {
  idEm = ok(amb.chamar('saveContrato', { tipo: 'emprestimo', credor: 'Nizar', devedor_nome: 'Carlos Souza', devedor_telefone: '64999990000',
    valor_emprestado: 10000, valor_a_receber: 11000, data_emprestimo: '2026-11-01', num_parcelas: 2, primeiro_vencimento: '2026-12-01', periodicidade: 'Mensal' }, t)).id;
  assert.strictEqual(idEm, 'EM0001');
  const r = ok(amb.chamar('getContrato', { tipo: 'emprestimo', id: idEm }, t)).registro;
  assert.deepStrictEqual(r.parcelas.map((p) => p.valor), [5500, 5500]);
  assert.strictEqual(r.devedor_telefone, '(64) 99999-0000');
  assert.strictEqual(r.nome, 'Carlos Souza');
  erro(amb.chamar('saveContrato', { tipo: 'emprestimo', devedor_nome: 'x', valor_emprestado: 10, num_parcelas: 1, primeiro_vencimento: '2026-12-01' }, t), 'quem emprestou');
});

teste('empréstimo sem valor a receber assume o valor emprestado', () => {
  const id = ok(amb.chamar('saveContrato', { tipo: 'emprestimo', credor: 'Adriana', devedor_nome: 'Joana', valor_emprestado: 2000,
    num_parcelas: 1, primeiro_vencimento: '2026-11-15', periodicidade: 'Mensal' }, t)).id;
  const r = ok(amb.chamar('getContrato', { tipo: 'emprestimo', id }, t)).registro;
  assert.strictEqual(r.valor_a_receber, 2000);
  assert.strictEqual(r.data_emprestimo, '2026-11-13');
  assert.strictEqual(r.parcelas[0].situacao, 'Vence em até 7 dias');
});

teste('baixa e estorno funcionam nas parcelas de pagamento', () => {
  const r = ok(amb.chamar('getContrato', { tipo: 'pagamento', id: idPg }, t)).registro;
  ok(amb.chamar('baixarParcela', { id: r.parcelas[0].id, forma_pagamento: 'PIX', data_pagamento: '2026-11-13' }, t));
  let r2 = ok(amb.chamar('getContrato', { tipo: 'pagamento', id: idPg }, t)).registro;
  assert.strictEqual(r2.total_recebido, 333.33);
  assert.strictEqual(r2.saldo, 666.67);
  assert.strictEqual(r2.situacao, 'Em dia');
  ok(amb.chamar('estornarParcela', { id: r.parcelas[0].id }, t));
  r2 = ok(amb.chamar('getContrato', { tipo: 'pagamento', id: idPg }, t)).registro;
  assert.strictEqual(r2.situacao, 'Em atraso');
  ok(amb.chamar('baixarParcela', { id: r.parcelas[0].id, forma_pagamento: 'Boleto' }, t));
});

teste('parcela avulsa num pagamento', () => {
  ok(amb.chamar('saveParcela', { venda_id: idPg, numero: 4, valor: 50, vencimento: '2027-03-10' }, t));
  const r = ok(amb.chamar('getContrato', { tipo: 'pagamento', id: idPg }, t)).registro;
  assert.strictEqual(r.parcelas.length, 4);
  assert.strictEqual(r.conferencia_ok, false);
  erro(amb.chamar('saveParcela', { venda_id: 'PG9999', numero: 1, valor: 5, vencimento: '2027-03-10' }, t), 'não encontrado');
});

teste('editar com parcela paga exige confirmação e preserva a paga', () => {
  const r = ok(amb.chamar('getContrato', { tipo: 'pagamento', id: idPg }, t)).registro;
  const paga = r.parcelas.find((p) => p.status === 'Pago');
  const base = { tipo: 'pagamento', id: idPg, favorecido: 'Gráfica Central', descricao: 'Placas de venda', categoria: 'Marketing', valor_total: 1000,
    num_parcelas: 2, primeiro_vencimento: '2026-11-10', periodicidade: 'Mensal',
    parcelas: [{ id: paga.id, numero: 1, valor: paga.valor, vencimento: paga.vencimento }, { numero: 2, valor: 666.67, vencimento: '2026-12-10' }] };
  erro(amb.chamar('saveContrato', base, t), 'CONFIRMAR');
  ok(amb.chamar('saveContrato', Object.assign({ confirmarRecalculo: true }, base), t));
  const r2 = ok(amb.chamar('getContrato', { tipo: 'pagamento', id: idPg }, t)).registro;
  assert.strictEqual(r2.parcelas.length, 2);
  assert.strictEqual(r2.parcelas[0].id, paga.id);
  assert.strictEqual(r2.parcelas[0].status, 'Pago');
  assert.strictEqual(r2.num_parcelas, 2);
  assert.strictEqual(r2.conferencia_ok, true);
});

teste('painel traz resumo e inclui pagamentos/empréstimos em "Atenção hoje"', () => {
  const d = ok(amb.chamar('getDashboard', {}, t));
  assert.strictEqual(d.contas.pagamento.em_aberto, 666.67);
  assert.strictEqual(d.contas.pagamento.quitado, 333.33);
  assert.strictEqual(d.contas.emprestimo.em_aberto, 13000);
  assert.strictEqual(d.contas.emprestimo.registros_abertos, 2);
  const emp = d.atencao.find((p) => p.tipo === 'emprestimo');
  assert.strictEqual(emp.cliente_nome, 'Joana');
  assert.strictEqual(emp.imovel, 'Empréstimo de Adriana');
  assert.strictEqual(d.cards.total_a_receber, 65000); // vendas não se misturam
  const parcelasVendas = ok(amb.chamar('listParcelas', {}, t)).parcelas;
  assert.ok(parcelasVendas.every((p) => p.venda_id.startsWith('V')));
});

teste('excluir empréstimo é lógico e fica no histórico', () => {
  ok(amb.chamar('deleteContrato', { tipo: 'emprestimo', id: idEm }, t));
  assert.ok(ok(amb.chamar('listContratos', { tipo: 'emprestimo' }, t)).registros.every((r) => r.id !== idEm));
  const log = ok(amb.chamar('listLog', {}, t));
  assert.ok(log.some((l) => l.entidade === 'emprestimo' && l.acao === 'excluir'));
  assert.ok(log.some((l) => l.entidade === 'pagamento' && l.acao === 'criar'));
});

console.log(`\n${passaram} teste(s) passaram${process.exitCode ? ', com falhas' : ''}.\n`);
