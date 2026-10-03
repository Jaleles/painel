import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, plain } from './harness.mjs';

const alerta = { id: 'oleo', name: 'Troca de óleo', interval: 7000, lastOdo: 142637, warnKm: 500, cost: 0, history: [] };
const tick = () => new Promise(r => setImmediate(r));

test('conserto à vista: vai para o histórico sem intervalo e vira despesa vinculada', () => {
  const app = load();
  app.setState({ odoBase: 147469, maintenances: [alerta] });
  const h = app.fn('registerRepair')({ desc: 'Farol', date: '2026-10-02', cost: 85, odo: 147500, link: true, ciclo: 'cartao' });
  const log = app.fn('repairLog')();
  assert.equal(log.id, 'consertos');
  assert.equal(log.interval, 0);
  assert.deepEqual(plain(log.history), [{ id: h.id, date: '2026-10-02', odo: 147500, cost: 85, note: 'Farol', expenseCiclo: 'cartao' }]);
  const exp = plain(app.state.expenses);
  assert.equal(exp.length, 1);
  assert.equal(exp[0].id, 'mn_' + h.id);
  assert.equal(exp[0].desc, 'Conserto · Farol');
  assert.equal(exp[0].cat, 'Transporte');
  assert.equal(exp[0].value, 85);
  assert.equal(exp[0].competencia, '2026-10');
  assert.equal(exp[0].origem, 'manutencao:consertos');
  assert.deepEqual(plain(app.state.outbox).map(o => o.action), ['saveMaint', 'saveMaintHist', 'saveExpense']);
});

test('conserto parcelado: lança as parcelas no Cartão e não cria despesa vinculada', async () => {
  const app = load();
  app.setState({ maintenances: [] });
  const h = app.fn('registerRepair')({ desc: 'Escapamento', date: '2026-10-01', cost: 571, odo: 147480, link: true, ciclo: 'cartao', parcelas: 3 });
  await tick();
  const exp = plain(app.state.expenses);
  assert.deepEqual(exp.map(e => e.value), [190.33, 190.33, 190.34]);
  assert.deepEqual(exp.map(e => e.date), ['2026-10-01', '2026-11-01', '2026-12-01']);
  assert.deepEqual(exp.map(e => e.desc), [1, 2, 3].map(n => `Conserto · Escapamento (parc ${n}/3)`));
  assert.ok(exp.every(e => e.cat === 'Transporte' && e.ciclo === 'cartao'));
  assert.equal(exp.some(e => e.id === 'mn_' + h.id), false);
  // sem vínculo no histórico: a planilha não deve recriar uma despesa de R$ 571 a partir dele
  assert.equal(app.fn('repairLog')().history[0].expenseCiclo, '');
  assert.equal(app.fn('repairLog')().history[0].cost, 571);
});

test('conserto sem lançar despesa fica só no Veículo', () => {
  const app = load();
  app.setState({});
  app.fn('registerRepair')({ desc: 'Fluido de freio', date: '2026-10-03', cost: 40, odo: 147500, link: false, ciclo: 'cartao' });
  assert.equal(app.state.expenses.length, 0);
  assert.equal(app.fn('repairLog')().history.length, 1);
});

test('vários consertos usam o mesmo registro e ficam do mais recente para o mais antigo', () => {
  const app = load();
  app.setState({});
  const reg = app.fn('registerRepair');
  reg({ desc: 'B', date: '2026-10-01', cost: 0, odo: 1, link: false });
  reg({ desc: 'A', date: '2026-09-20', cost: 0, odo: 1, link: false });
  reg({ desc: 'C', date: '2026-10-03', cost: 0, odo: 1, link: false });
  assert.equal(app.state.maintenances.length, 1);
  assert.deepEqual(plain(app.fn('repairLog')().history).map(h => h.note), ['C', 'B', 'A']);
  assert.equal(app.state.outbox.filter(o => o.action === 'saveMaint').length, 1);
});

test('consertos não geram alerta de km, mas entram no custo do veículo', () => {
  const app = load();
  app.setState({ odoBase: 147469, maintenances: [alerta] });
  app.fn('registerRepair')({ desc: 'Bateria', date: '2026-08-06', cost: 400, odo: 146000, link: false });
  assert.deepEqual([...app.fn('alertMaintenances')().map(m => m.id)], ['oleo']);
  app.fn('renderDashAlerts')();
  assert.equal(document.getElementById('dashAlerts').children.length, 0);   // óleo ainda longe, conserto não alerta
  const st = plain(app.fn('vehicleStats')(app.fn('calcFuels')()));
  assert.equal(st.maintCost, 400);
});

test('excluir conserto remove o histórico, a despesa vinculada e avisa a planilha', () => {
  const app = load();
  app.setState({});
  const h = app.fn('registerRepair')({ desc: 'Farol', date: '2026-10-02', cost: 85, odo: 1, link: true, ciclo: 'contas' });
  app.fn('deleteRepair')(h.id);
  assert.equal(app.fn('repairLog')().history.length, 0);
  assert.equal(app.state.expenses.length, 0);
  const ops = plain(app.state.outbox).map(o => [o.k, o.action]);
  assert.deepEqual(ops.filter(([k]) => k.startsWith('mhist:') || k.startsWith('exp:')).sort(),
    [['exp:mn_' + h.id, 'deleteExpense'], ['mhist:' + h.id, 'deleteMaintHist']]);
  const del = plain(app.state.outbox).find(o => o.action === 'deleteMaintHist');
  assert.deepEqual(del.body, { id: h.id, maintId: 'consertos' });
});

test('exclusão pendente na fila é reaplicada depois de buscar a planilha', () => {
  const app = load();
  const hist = [{ id: 'h1', date: '2026-10-01', odo: 1, cost: 10, note: 'X', expenseCiclo: '' }];
  app.setState({ syncedOnce: true });
  app.fn('enqueueRaw')('mhist:h1', 'deleteMaintHist', { id: 'h1', maintId: 'consertos' });
  app.fn('applyServerData')({ config: {}, expenses: [], fixedItems: [], vehicle: { odoBase: 0, fuels: [], maintenances: [{ id: 'consertos', name: 'Consertos e serviços', interval: 0, history: hist }] } });
  assert.equal(app.fn('repairLog')().history.length, 0);
});
