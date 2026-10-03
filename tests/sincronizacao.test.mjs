import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, plain } from './harness.mjs';

const exp = (id, value, extra = {}) => ({ id, date: '2026-09-10', desc: 'd' + id, cat: 'Outros', value, ciclo: 'cartao', competencia: '2026-09', fixedId: null, origem: '', ...extra });

test('fila: nova operação com a mesma chave substitui a anterior', () => {
  const app = load();
  app.setState({});
  const enq = app.fn('enqueueRaw');
  enq('exp:1', 'saveExpense', { item: exp('1', 10) });
  enq('exp:2', 'saveExpense', { item: exp('2', 20) });
  enq('exp:1', 'deleteExpense', { id: '1' });
  assert.deepEqual(plain(app.state.outbox).map(o => [o.k, o.action]), [['exp:2', 'saveExpense'], ['exp:1', 'deleteExpense']]);
});

test('fila: envio do veículo inteiro descarta operações avulsas do veículo', () => {
  const app = load();
  app.setState({});
  const enq = app.fn('enqueueRaw');
  enq('fuel:a', 'saveFuel', {});
  enq('maint:b', 'saveMaint', {});
  enq('mhist:c', 'saveMaintHist', {});
  enq('exp:1', 'saveExpense', { item: exp('1', 10) });
  enq('vehicle:full', 'saveVehicle', {});
  assert.deepEqual(plain(app.state.outbox).map(o => o.k), ['exp:1', 'vehicle:full']);
});

test('planilha é a fonte da verdade, mas o que está na fila é reaplicado por cima', () => {
  const app = load();
  app.setState({ syncedOnce: true, expenses: [exp('local-antigo', 1)] });
  const enq = app.fn('enqueueRaw');
  enq('exp:2', 'saveExpense', { item: exp('2', 99) });       // editado no app, ainda não enviado
  enq('exp:3', 'deleteExpense', { id: '3' });                 // excluído no app, ainda não enviado
  enq('exp:4', 'saveExpense', { item: exp('4', 40) });        // criado no app
  app.fn('applyServerData')({
    config: { monthlyLimit: '2500', startDate: '31/08/2026', endDate: '29/09/2026', cardInvoiceName: 'Visa' },
    expenses: [exp('1', 10), exp('2', 20), exp('3', 30)],
    fixedItems: []
  });
  const byId = Object.fromEntries(plain(app.state.expenses).map(e => [e.id, e.value]));
  assert.deepEqual(byId, { 1: 10, 2: 99, 4: 40 });
  assert.equal(app.state.monthlyLimit, 2500);
  assert.equal(app.state.startDate, '2026-08-31');
  assert.equal(app.state.endDate, '2026-09-29');
  assert.equal(app.state.cardInvoiceName, 'Visa');
});

test('1ª sincronização: planilha sem veículo recebe o veículo do aparelho', () => {
  const app = load();
  const fuel = { id: 'f1', ord: 1, date: '2026-09-01', partial: 0, fuelType: 'gas', trajeto: '', pricePerLiter: 6, liters: 10, total: 60, calcField: '', note: '', expenseCiclo: '' };
  app.setState({ syncedOnce: false, fuels: [fuel] });
  app.fn('applyServerData')({ config: {}, expenses: [], fixedItems: [], vehicle: { odoBase: 0, fuels: [], maintenances: [] } });
  assert.equal(app.state.fuels.length, 1);
  assert.deepEqual(plain(app.state.outbox).map(o => o.k), ['vehicle:full']);
  assert.equal(app.state.syncedOnce, true);
});

test('depois da 1ª sincronização, o veículo da planilha substitui o local', () => {
  const app = load();
  const fuel = { id: 'f1', date: '2026-09-01', partial: 0, fuelType: 'gas', liters: 10, total: 60 };
  app.setState({ syncedOnce: true, fuels: [fuel] });
  app.fn('applyServerData')({ config: {}, expenses: [], fixedItems: [], vehicle: { odoBase: 1000, fuels: [], maintenances: [] } });
  assert.equal(app.state.fuels.length, 0);
  assert.equal(app.state.odoBase, 1000);
});
