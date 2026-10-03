import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, plain } from './harness.mjs';

const fixa = (id, desc, refValue, extra = {}) => ({ id, desc, cat: desc, refValue, dueDay: 10, inicio: '2026-07', fim: '', ...extra });
const bill = (id, comp, value, fixedId = null, extra = {}) => ({ id, date: comp + '-10', desc: 'b' + id, cat: 'Outros', value, ciclo: 'contas', competencia: comp, fixedId, origem: '', ...extra });

test('projeção de Contas = fixas lançadas + pendentes estimadas pelo último valor + avulsos', () => {
  const app = load();
  app.setState({
    fixedItems: [fixa('luz', 'Luz', 200), fixa('agua', 'Água', 90), fixa('net', 'Internet', 150)],
    expenses: [
      bill('1', '2026-08', 230.5, 'agua'),   // último valor pago da Água (antes de 09)
      bill('2', '2026-09', 237.6, 'luz'),    // Luz já lançada em 09
      bill('3', '2026-09', 40)               // avulso
    ]
  });
  const p = plain(app.fn('billsProjection')('2026-09'));
  assert.equal(p.spent, 277.6);
  assert.equal(p.fixasLaunched, 237.6);
  assert.equal(Math.round(p.avulsos * 100) / 100, 40);
  assert.equal(p.pendingCount, 2);
  assert.equal(p.pendingEstimate, 230.5 + 150);   // Água pelo último pago; Internet pelo valor de referência
  assert.equal(Math.round(p.total * 100) / 100, 658.1);
});

test('fixa só conta dentro do período de início e fim', () => {
  const app = load();
  app.setState({ fixedItems: [fixa('a', 'Antiga', 100, { fim: '2026-08' }), fixa('n', 'Nova', 50, { inicio: '2026-10' }), fixa('v', 'Vigente', 10)] });
  const pend = app.fn('pendingFixasFor')('2026-09').map(f => f.id);
  assert.deepEqual([...pend], ['v']);
});

test('tela de Contas avança para o mês seguinte só quando todas as fixas do mês foram lançadas', () => {
  const app = load({ today: '2026-09-15T12:00:00' });
  app.setState({ fixedItems: [fixa('luz', 'Luz', 200), fixa('agua', 'Água', 90)], expenses: [bill('1', '2026-09', 200, 'luz')] });
  assert.equal(app.fn('autoBillsCompetencia')(), '2026-09');
  app.setState({ fixedItems: [fixa('luz', 'Luz', 200), fixa('agua', 'Água', 90)], expenses: [bill('1', '2026-09', 200, 'luz'), bill('2', '2026-09', 90, 'agua')] });
  assert.equal(app.fn('autoBillsCompetencia')(), '2026-10');
});

test('parcelamento pelo valor total: a última parcela absorve os centavos', async () => {
  const app = load();
  app.setState({});
  app.fn('addParcelas')({ desc: 'Bateria', cat: 'Outros', date: '2026-08-31', competencia: '2026-08', value: 400, ciclo: 'cartao', fixedId: null, total: 3, valueIsTotal: true });
  const ps = plain(app.state.expenses);
  assert.deepEqual(ps.map(e => e.value), [133.33, 133.33, 133.34]);
  assert.deepEqual(ps.map(e => e.date), ['2026-08-31', '2026-09-30', '2026-10-31']);
  assert.deepEqual(ps.map(e => e.competencia), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(ps.map(e => e.desc), ['Bateria (parc 1/3)', 'Bateria (parc 2/3)', 'Bateria (parc 3/3)']);
  const group = ps[0].origem.split(':')[1];
  assert.deepEqual(ps.map(e => e.origem), [1, 2, 3].map(n => `parcela:${group}:${n}/3`));
  assert.deepEqual(plain(app.fn('parcelaInfo')(ps[1])), { group, n: 2, total: 3 });
  // cada parcela vai para a fila de envio da planilha (o app enfileira de forma assíncrona)
  await new Promise(r => setImmediate(r));
  assert.equal(app.state.outbox.filter(o => o.action === 'saveExpense').length, 3);
});

test('parcelamento pelo valor da parcela repete o mesmo valor', () => {
  const app = load();
  app.setState({});
  app.fn('addParcelas')({ desc: 'Riachuelo', cat: 'Vestuário', date: '2026-08-16', competencia: '2026-08', value: 49.99, ciclo: 'cartao', fixedId: null, total: 2, valueIsTotal: false });
  assert.deepEqual(plain(app.state.expenses).map(e => e.value), [49.99, 49.99]);
});

test('fixa sem início recebe a competência do 1º lançamento', () => {
  const app = load({ today: '2026-09-15T12:00:00' });
  app.setState({
    fixedItems: [fixa('luz', 'Luz', 200, { inicio: '' }), fixa('nova', 'Nova', 10, { inicio: '' })],
    expenses: [bill('2', '2026-08', 200, 'luz'), bill('1', '2026-07', 190, 'luz')]
  });
  app.fn('ensureFixasInicio')();
  assert.deepEqual(plain(app.state.fixedItems).map(f => f.inicio), ['2026-07', '2026-09']);
});
