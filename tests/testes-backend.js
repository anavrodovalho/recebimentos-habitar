'use strict';
/**
 * Testes do backend (Apps Script) rodando no simulador.
 * Rode: node tests/testes-backend.js
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
const { ss } = amb;

console.log('\nInstalação e migração');
teste('setupDatabase cria db_* e migra os exemplos', () => {
  amb.rodar('setupDatabase');
  ['db_vendas', 'db_parcelas', 'db_usuarios', 'db_log'].forEach((n) => assert.ok(ss.getSheetByName(n), 'falta ' + n));
  assert.ok(ss.getSheetByName('backup_Vendas') && ss.getSheetByName('backup_Parcelas') && ss.getSheetByName('backup_Resumo'));
  assert.strictEqual(ss.getSheetByName('Vendas'), null);
  assert.strictEqual(ss.getSheetByName('db_vendas').getLastRow(), 4);   // cabeçalho + 3
  assert.strictEqual(ss.getSheetByName('db_parcelas').getLastRow(), 11); // cabeçalho + 10
  assert.strictEqual(ss.sheets[0].name, 'db_vendas');
});
teste('datas gravadas como texto yyyy-mm-dd e ids V0001/P00001', () => {
  const v = ss.getSheetByName('db_vendas').getDataRange().getValues();
  assert.strictEqual(v[1][0], 'V0001');
  assert.strictEqual(v[1][9], '2026-09-10');
  assert.strictEqual(typeof v[1][9], 'string');
  const p = ss.getSheetByName('db_parcelas').getDataRange().getValues();
  assert.strictEqual(p[1][0], 'P00001');
  assert.strictEqual(p[1][4], '2026-09-10');
  assert.strictEqual(p[1][7], 5000); // valor_pago numérico
});
teste('setupDatabase não roda duas vezes', () => {
  assert.throws(() => amb.rodar('setupDatabase'), /já foi configurado/);
});

console.log('\nUsuários e sessão');
let token;
teste('criarUsuario grava hash (sem senha em texto)', () => {
  amb.rodar('criarUsuario', 'ana', 'Ana Laura', 'segredo123');
  amb.rodar('criarUsuario', 'adriana', 'Adriana', 'outra456');
  const u = ss.getSheetByName('db_usuarios').getDataRange().getValues();
  assert.strictEqual(u.length, 3);
  assert.ok(!u[1].join('|').includes('segredo123'));
  assert.ok(/^[0-9a-f]{32}\$[0-9a-f]{64}$/.test(u[1][2]));
  assert.throws(() => amb.rodar('criarUsuario', 'x', 'X', '123'), /6 caracteres/);
});
teste('API sem token é recusada', () => {
  erro(amb.chamar('listVendas', {}), 'SESSAO');
  erro(amb.chamar('listVendas', {}, 'tokenfalso'), 'SESSAO');
});
teste('login errado falha, login certo devolve token', () => {
  erro(amb.chamar('login', { usuario: 'ana', senha: 'errada' }), 'incorretos');
  const d = ok(amb.chamar('login', { usuario: 'ANA', senha: 'segredo123' }));
  assert.ok(d.token.length >= 32);
  assert.strictEqual(d.nome, 'Ana Laura');
  token = d.token;
});
teste('ação desconhecida é recusada', () => erro(amb.chamar('qualquerCoisa', {}, token), 'desconhecida'));
teste('sessão vale 12 h e depois expira', () => {
  const t2 = ok(amb.chamar('login', { usuario: 'adriana', senha: 'outra456' })).token;
  amb.setAgora('2026-11-13T20:00:00-03:00');
  ok(amb.chamar('listVendas', {}, t2));
  amb.setAgora('2026-11-14T03:30:00-03:00'); // 12 h 30 depois do login
  erro(amb.chamar('listVendas', {}, t2), 'SESSAO');
  amb.setAgora('2026-11-13T15:00:00-03:00');
  token = ok(amb.chamar('login', { usuario: 'ana', senha: 'segredo123' })).token;
});

console.log('\nGeração de parcelas');
teste('divide igualmente e ajusta centavos na última (1000 / 3)', () => {
  const p = amb.rodar('gerarParcelas_', 1000, 3, '2026-12-31', 'Mensal');
  assert.deepStrictEqual(p.map((x) => x.valor), [333.33, 333.33, 333.34]);
  assert.deepStrictEqual(p.map((x) => x.vencimento), ['2026-12-31', '2027-01-31', '2027-02-28']);
});
teste('quinzenal soma 15 dias; personalizada usa as datas dadas', () => {
  const q = amb.rodar('gerarParcelas_', 300, 3, '2026-11-20', 'Quinzenal');
  assert.deepStrictEqual(q.map((x) => x.vencimento), ['2026-11-20', '2026-12-05', '2026-12-20']);
  const c = amb.rodar('gerarParcelas_', 300, 2, '2026-11-20', 'Personalizada', ['2026-11-25', '2027-01-05']);
  assert.deepStrictEqual(c.map((x) => x.vencimento), ['2026-11-25', '2027-01-05']);
});

console.log('\nVendas');
let idVenda6x, idVenda1x;
teste('cadastra venda com entrada parcelada em 6x (R$ 10.000,01)', () => {
  const d = ok(amb.chamar('saveVenda', {
    cliente_nome: 'Maria Teste', cliente_telefone: '64992608103', imovel: 'Casa Qd 5 Lt 10', valor_imovel: 350000,
    tipo_condicao: 'Entrada parcelada', valor_entrada: 10000.01, num_parcelas: 6, primeiro_vencimento: '2026-12-10',
    periodicidade: 'Mensal', corretor: 'Adriana',
  }, token));
  idVenda6x = d.id;
  assert.strictEqual(idVenda6x, 'V0004');
  const v = ok(amb.chamar('getVenda', { id: idVenda6x }, token)).venda;
  assert.strictEqual(v.parcelas.length, 6);
  assert.deepStrictEqual(v.parcelas.map((p) => p.valor), [1666.66, 1666.66, 1666.66, 1666.66, 1666.66, 1666.71]);
  assert.strictEqual(v.soma_parcelas, 10000.01);
  assert.strictEqual(v.conferencia_ok, true);
  assert.strictEqual(v.cliente_telefone, '(64) 99260-8103');
  assert.strictEqual(v.parcelas[5].vencimento, '2027-05-10');
  assert.strictEqual(v.situacao, 'Em dia');
  assert.strictEqual(v.saldo, 10000.01);
});
teste('cadastra entrada a prazo (1x)', () => {
  const d = ok(amb.chamar('saveVenda', {
    cliente_nome: 'João Prazo', imovel: 'Lote 7', tipo_condicao: 'Entrada a prazo', valor_entrada: 20000,
    num_parcelas: 1, primeiro_vencimento: '2026-12-20', periodicidade: 'Mensal',
  }, token));
  idVenda1x = d.id;
  const v = ok(amb.chamar('getVenda', { id: idVenda1x }, token)).venda;
  assert.strictEqual(v.parcelas.length, 1);
  assert.strictEqual(v.parcelas[0].valor, 20000);
  assert.strictEqual(v.parcelas[0].situacao, 'A vencer');
});
teste('validação: campos obrigatórios e valores inválidos', () => {
  erro(amb.chamar('saveVenda', { imovel: 'x', valor_entrada: 10, num_parcelas: 1, primeiro_vencimento: '2026-12-01', tipo_condicao: 'Outro' }, token), 'nome do cliente');
  erro(amb.chamar('saveVenda', { cliente_nome: 'a', imovel: 'x', valor_entrada: 0, num_parcelas: 1, primeiro_vencimento: '2026-12-01', tipo_condicao: 'Outro' }, token), 'maior que zero');
  erro(amb.chamar('saveVenda', { cliente_nome: 'a', imovel: 'x', valor_entrada: 10, num_parcelas: 1.5, primeiro_vencimento: '2026-12-01', tipo_condicao: 'Outro' }, token), 'inteiro');
  erro(amb.chamar('saveVenda', { cliente_nome: 'a', imovel: 'x', valor_entrada: 10, num_parcelas: 1, primeiro_vencimento: '2026-02-30', tipo_condicao: 'Outro' }, token), 'data válida');
  erro(amb.chamar('saveVenda', { cliente_nome: 'a', imovel: 'x', valor_entrada: 10, num_parcelas: 1, primeiro_vencimento: '2026-12-01', tipo_condicao: 'Outro',
    parcelas: [{ numero: 1, valor: 0, vencimento: '2026-12-01' }] }, token), 'maior que zero');
});
teste('prévia editada é respeitada (parcelas enviadas pelo site)', () => {
  const d = ok(amb.chamar('saveVenda', {
    cliente_nome: 'Prévia Editada', imovel: 'Apto 1', tipo_condicao: 'Entrada parcelada', valor_entrada: 3000,
    num_parcelas: 2, primeiro_vencimento: '2026-12-01', periodicidade: 'Personalizada',
    parcelas: [{ numero: 1, valor: 1000, vencimento: '2026-12-01' }, { numero: 2, valor: 2000, vencimento: '2027-03-15' }],
  }, token));
  const v = ok(amb.chamar('getVenda', { id: d.id }, token)).venda;
  assert.deepStrictEqual(v.parcelas.map((p) => [p.valor, p.vencimento]), [[1000, '2026-12-01'], [2000, '2027-03-15']]);
  ok(amb.chamar('deleteVenda', { id: d.id }, token));
});

console.log('\nBaixa, estorno e edição de parcela');
teste('dar baixa atualiza recebido, saldo e situação', () => {
  const v = ok(amb.chamar('getVenda', { id: idVenda6x }, token)).venda;
  const p1 = v.parcelas[0];
  ok(amb.chamar('baixarParcela', { id: p1.id, data_pagamento: '2026-11-13', valor_pago: 1700, forma_pagamento: 'PIX' }, token));
  const v2 = ok(amb.chamar('getVenda', { id: idVenda6x }, token)).venda;
  assert.strictEqual(v2.total_recebido, 1700);
  assert.strictEqual(v2.parcelas_pagas, 1);
  assert.strictEqual(v2.saldo, 8333.35);
  assert.strictEqual(v2.parcelas[0].situacao, 'Pago');
  assert.strictEqual(v2.proximo_vencimento, '2027-01-10');
  erro(amb.chamar('baixarParcela', { id: p1.id, forma_pagamento: 'PIX' }, token), 'já está paga');
  erro(amb.chamar('baixarParcela', { id: v.parcelas[1].id, forma_pagamento: 'Vale' }, token), 'forma de pagamento');
});
teste('estornar volta para A pagar', () => {
  const v = ok(amb.chamar('getVenda', { id: idVenda6x }, token)).venda;
  ok(amb.chamar('estornarParcela', { id: v.parcelas[0].id }, token));
  const v2 = ok(amb.chamar('getVenda', { id: idVenda6x }, token)).venda;
  assert.strictEqual(v2.total_recebido, 0);
  assert.strictEqual(v2.parcelas[0].status, 'A pagar');
  assert.strictEqual(v2.parcelas[0].data_pagamento, '');
  assert.strictEqual(v2.saldo, 10000.01);
  erro(amb.chamar('estornarParcela', { id: v.parcelas[0].id }, token), 'não está paga');
});
teste('editar parcela muda valor e vencimento; conferência avisa', () => {
  const v = ok(amb.chamar('getVenda', { id: idVenda6x }, token)).venda;
  const p = v.parcelas[1];
  ok(amb.chamar('saveParcela', { id: p.id, venda_id: idVenda6x, numero: 2, valor: 2000, vencimento: '2026-11-01', observacoes: 'renegociada' }, token));
  const v2 = ok(amb.chamar('getVenda', { id: idVenda6x }, token)).venda;
  assert.strictEqual(v2.parcelas[1].valor, 2000);
  assert.strictEqual(v2.parcelas[1].situacao, 'Atrasado');
  assert.strictEqual(v2.parcelas[1].dias_atraso, 12);
  assert.strictEqual(v2.conferencia_ok, false);
  assert.strictEqual(v2.situacao, 'Em atraso');
  ok(amb.chamar('saveParcela', { id: p.id, venda_id: idVenda6x, numero: 2, valor: 1666.66, vencimento: '2027-01-10' }, token));
  assert.strictEqual(ok(amb.chamar('getVenda', { id: idVenda6x }, token)).venda.conferencia_ok, true);
});
teste('parcela avulsa: criar e excluir; paga não pode ser excluída', () => {
  const d = ok(amb.chamar('saveParcela', { venda_id: idVenda1x, numero: 2, valor: 500, vencimento: '2027-01-05' }, token));
  assert.ok(/^P\d{5}$/.test(d.id));
  ok(amb.chamar('baixarParcela', { id: d.id, forma_pagamento: 'Dinheiro' }, token));
  erro(amb.chamar('deleteParcela', { id: d.id }, token), 'Estorne');
  ok(amb.chamar('estornarParcela', { id: d.id }, token));
  ok(amb.chamar('deleteParcela', { id: d.id }, token));
  assert.strictEqual(ok(amb.chamar('getVenda', { id: idVenda1x }, token)).venda.parcelas.length, 1);
});

console.log('\nPainel');
teste('parcela vencida aparece em atraso no painel e em "Atenção hoje"', () => {
  const d = ok(amb.chamar('getDashboard', {}, token));
  assert.strictEqual(d.hoje, '2026-11-13');
  assert.strictEqual(d.cards.valor_em_atraso, 5000);       // V0001 parcela 3 (10/11/2026)
  assert.strictEqual(d.cards.parcelas_atrasadas, 1);
  assert.strictEqual(d.cards.parcelas_7_dias, 1);          // V0002 em 18/11/2026
  assert.strictEqual(d.cards.total_recebido, 22000);
  assert.strictEqual(d.cards.vendas_quitadas, 1);
  assert.strictEqual(d.cards.vendas_em_aberto, 4);
  assert.strictEqual(d.atencao[0].venda_id, 'V0001');
  assert.strictEqual(d.atencao[0].situacao, 'Atrasado');
  assert.strictEqual(d.atencao[0].dias_atraso, 3);
  assert.strictEqual(d.atencao[0].cliente_nome, 'Cliente Exemplo 1');
  assert.strictEqual(d.atencao[1].situacao, 'Vence em até 7 dias');
  assert.strictEqual(d.previsao.meses.length, 12);
  assert.strictEqual(d.previsao.meses[0].mes, '2026-11');
  assert.strictEqual(d.previsao.meses[0].previsto, 50000);
  assert.strictEqual(d.previsao.anteriores.recebido, 22000);
});
teste('listParcelas traz cliente/imóvel e situação calculada', () => {
  const d = ok(amb.chamar('listParcelas', {}, token));
  const atrasada = d.parcelas.find((p) => p.situacao === 'Atrasado');
  assert.strictEqual(atrasada.imovel, 'Apto 204 – Ed. Exemplo');
  assert.strictEqual(atrasada.cliente_telefone, '(64) 99999-0001');
});

console.log('\nEdição de venda com parcelas pagas');
teste('recalcular parcelas de venda com pagas exige confirmação e preserva as pagas', () => {
  const v = ok(amb.chamar('getVenda', { id: 'V0001' }, token)).venda; // 2 pagas, 4 em aberto
  const abertas = v.parcelas.filter((p) => p.status !== 'Pago');
  const novas = v.parcelas.filter((p) => p.status === 'Pago').concat([
    { id: abertas[0].id, numero: 3, valor: 10000, vencimento: '2026-12-15' },
    { id: abertas[1].id, numero: 4, valor: 10000, vencimento: '2027-01-15' },
  ]);
  const base = { id: 'V0001', cliente_nome: v.cliente_nome, imovel: v.imovel, tipo_condicao: v.tipo_condicao, valor_entrada: 30000,
    num_parcelas: 4, primeiro_vencimento: v.primeiro_vencimento, periodicidade: 'Mensal', corretor: v.corretor, parcelas: novas };
  erro(amb.chamar('saveVenda', base, token), 'CONFIRMAR');
  ok(amb.chamar('saveVenda', Object.assign({ confirmarRecalculo: true }, base), token));
  const v2 = ok(amb.chamar('getVenda', { id: 'V0001' }, token)).venda;
  assert.strictEqual(v2.parcelas.length, 4);
  assert.deepStrictEqual(v2.parcelas.filter((p) => p.status === 'Pago').map((p) => p.valor), [5000, 5000]);
  assert.deepStrictEqual(v2.parcelas.filter((p) => p.status !== 'Pago').map((p) => p.valor), [10000, 10000]);
  assert.strictEqual(v2.total_recebido, 10000);
  assert.strictEqual(v2.num_parcelas, 4);
  assert.strictEqual(v2.conferencia_ok, true);
  assert.strictEqual(v2.situacao, 'Em dia');
});
teste('editar só os dados da venda não mexe nas parcelas', () => {
  const v = ok(amb.chamar('getVenda', { id: 'V0002' }, token)).venda;
  ok(amb.chamar('saveVenda', { id: 'V0002', cliente_nome: 'Cliente Exemplo 2 Editado', imovel: v.imovel, tipo_condicao: v.tipo_condicao,
    valor_entrada: v.valor_entrada, num_parcelas: v.num_parcelas, primeiro_vencimento: v.primeiro_vencimento, periodicidade: 'Mensal' }, token));
  const v2 = ok(amb.chamar('getVenda', { id: 'V0002' }, token)).venda;
  assert.strictEqual(v2.cliente_nome, 'Cliente Exemplo 2 Editado');
  assert.strictEqual(v2.parcelas.length, 1);
  assert.strictEqual(v2.parcelas[0].id, v.parcelas[0].id);
});

console.log('\nExclusão e histórico');
teste('excluir venda é lógico e some das listas', () => {
  ok(amb.chamar('deleteVenda', { id: idVenda1x }, token));
  const lista = ok(amb.chamar('listVendas', {}, token)).vendas;
  assert.ok(!lista.some((v) => v.id === idVenda1x));
  erro(amb.chamar('getVenda', { id: idVenda1x }, token), 'não encontrada');
  const bruto = ss.getSheetByName('db_vendas').getDataRange().getValues().find((l) => l[0] === idVenda1x);
  assert.strictEqual(bruto[13], false); // ativo
});
teste('db_log registra quem fez o quê', () => {
  const log = ok(amb.chamar('listLog', {}, token));
  const acoes = new Set(log.map((l) => l.acao));
  ['setup', 'criar', 'editar', 'excluir', 'baixa', 'estorno'].forEach((a) => assert.ok(acoes.has(a), 'falta ação ' + a));
  assert.ok(log.every((l) => l.data_hora && l.usuario));
  assert.ok(log.some((l) => l.usuario === 'Ana Laura' && l.acao === 'baixa'));
  assert.strictEqual(log[0].acao, 'excluir'); // mais recente primeiro
});
teste('logout invalida o token', () => {
  ok(amb.chamar('logout', {}, token));
  erro(amb.chamar('listVendas', {}, token), 'SESSAO');
});

console.log(`\n${passaram} teste(s) passaram${process.exitCode ? ', com falhas' : ''}.\n`);
