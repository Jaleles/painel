import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, plain } from './harness.mjs';

const fuel = (id, date, fuelType, partial, liters, total, trajeto = '') =>
  ({ id, ord: 0, date, partial, fuelType, trajeto, pricePerLiter: total / liters, liters, total, calcField: '', note: '', expenseCiclo: '' });

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('reserva a reserva: km/L[N] = parcial[N] ÷ litros[N−1], no combustível do anterior', () => {
  const app = load();
  app.setState({
    fuels: [
      fuel('c', '2026-09-20', 'gas', 280, 20, 120, 'estrada'),
      fuel('a', '2026-09-01', 'eth', 0, 30, 150),
      fuel('b', '2026-09-10', 'gas', 210, 25, 140, 'cidade')
    ]
  });
  const fs = plain(app.fn('calcFuels')());
  assert.deepEqual(fs.map(f => f.id), ['a', 'b', 'c']);        // ordenado por data
  assert.equal(fs[0].consumption, null);                       // 1º não tem trecho
  close(fs[1].consumption, 210 / 30);                          // queimou o etanol do 1º
  assert.equal(fs[1].burnedFuel, 'eth');
  close(fs[1].costPerKm, 150 / 210);                           // R$/km = total anterior ÷ parcial
  close(fs[2].consumption, 280 / 25);
  assert.equal(fs[2].burnedFuel, 'gas');
});

test('médias nunca misturam etanol e gasolina; separam por trajeto', () => {
  const app = load();
  app.setState({
    fuels: [
      fuel('1', '2026-08-01', 'eth', 0, 30, 150),
      fuel('2', '2026-08-08', 'eth', 210, 30, 150, 'cidade'),   // 210/30 = 7 (etanol)
      fuel('3', '2026-08-15', 'gas', 240, 25, 150, 'estrada'),  // 240/30 = 8 (etanol)
      fuel('4', '2026-08-22', 'gas', 250, 25, 150, 'cidade'),   // 250/25 = 10 (gasolina)
      fuel('5', '2026-08-29', 'gas', 275, 25, 150, 'estrada')   // 275/25 = 11 (gasolina)
    ],
    maintenances: [{ id: 'm', name: 'Óleo', interval: 5000, lastOdo: 0, warnKm: 500, cost: 0, history: [{ id: 'h', date: '2026-08-20', odo: 0, cost: 195, note: '', expenseCiclo: '' }] }]
  });
  const st = plain(app.fn('vehicleStats')(app.fn('calcFuels')()));
  close(st.byFuel.eth.avg, 450 / 60);
  close(st.byFuel.gas.avg, 525 / 50);
  close(st.byFuel.eth.byTrajeto.cidade.avg, 7);
  close(st.byFuel.eth.byTrajeto.estrada.avg, 8);
  close(st.byFuel.gas.byTrajeto.estrada.avg, 11);
  assert.equal(st.byFuel.die, undefined);
  close(st.cpk, 600 / 975);                                     // R$/km vale para os dois combustíveis
  close(st.cpkTotal, (600 + 195) / 975);                        // incluindo manutenção
  assert.equal(st.totalSpent, 750);
  assert.equal(st.maintCost, 195);
});

test('média recente usa só os 3 últimos trechos do combustível', () => {
  const app = load();
  const fuels = [fuel('0', '2026-07-01', 'gas', 0, 10, 60)];
  [100, 100, 120, 130, 140].forEach((km, i) => fuels.push(fuel(String(i + 1), `2026-07-0${i + 2}`, 'gas', km, 10, 60)));
  app.setState({ fuels });
  const st = plain(app.fn('vehicleStats')(app.fn('calcFuels')()));
  close(st.byFuel.gas.recentAvg, (120 + 130 + 140) / 30);
  close(st.byFuel.gas.avg, 590 / 50);
});

test('resumo mensal soma gasto, litros e km e calcula R$/km do mês', () => {
  const app = load();
  app.setState({ fuels: [fuel('1', '2026-08-28', 'gas', 0, 20, 120), fuel('2', '2026-09-06', 'gas', 200, 15, 100), fuel('3', '2026-09-20', 'gas', 150, 10, 60)] });
  const m = plain(app.fn('monthlySummary')(app.fn('calcFuels')()));
  assert.deepEqual(m.map(x => x.ym), ['2026-08', '2026-09']);
  assert.equal(m[1].spent, 160);
  assert.equal(m[1].liters, 25);
  assert.equal(m[1].km, 350);
  close(m[1].cpk, (120 + 100) / 350);
});

test('campo faltante (preço, litros ou total) é calculado só como referência', () => {
  const app = load();
  const r = app.fn('resolveFields');
  assert.deepEqual(plain(r('5,99', '', '150')), { pricePerLiter: 5.99, liters: 25.042, total: 150, calcField: 'liters' });
  assert.deepEqual(plain(r('5,99', '25', '')), { pricePerLiter: 5.99, liters: 25, total: 149.75, calcField: 'total' });
  assert.deepEqual(plain(r('', '37,6', '150')), { pricePerLiter: 3.989, liters: 37.6, total: 150, calcField: 'pricePerLiter' });
  assert.deepEqual(plain(r('5,99', '25', '149,75')), { pricePerLiter: 5.99, liters: 25, total: 149.75, calcField: '' });
  assert.equal(r('5,99', '', ''), null);
});

test('hodômetro total = base + soma das parciais; formato antigo é convertido', () => {
  const app = load();
  const v = plain(app.fn('normalizeVehicle')({ odometer: 50500, fuels: [fuel('1', '2026-09-01', 'gas', 200, 10, 60), fuel('2', '2026-09-08', 'gas', 300, 10, 60)] }));
  assert.equal(v.odoBase, 50000);
  app.setState(v);
  assert.equal(app.fn('getOdometer')(), 50500);
  assert.equal(plain(app.fn('normalizeVehicle')({ odoBase: 0, odometer: 999, fuels: [] })).odoBase, 0);
});
