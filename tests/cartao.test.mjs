import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const exp = (id, date, value, extra = {}) => ({ id: String(id), date, desc: 'x' + id, cat: 'Alimentação', value, ciclo: 'cartao', competencia: date.slice(0, 7), fixedId: null, origem: '', ...extra });

test('ciclo do Cartão filtra pela DATA da compra, não pela competência', () => {
  const app = load();
  app.setState({
    startDate: '2026-08-31', endDate: '2026-09-29',
    expenses: [
      exp(1, '2026-08-30', 10),
      exp(2, '2026-08-31', 20),                          // 1º dia: entra
      exp(3, '2026-09-29', 30),                          // último dia: entra
      exp(4, '2026-09-30', 40, { competencia: '2026-09' }), // fora do período, mesmo com competência 09
      exp(5, '2026-09-10', 50, { ciclo: 'contas' })      // Contas nunca entra
    ]
  });
  const ids = app.fn('cartaoCycleExpenses')().map(e => e.id);
  assert.deepEqual([...ids], ['2', '3']);
});

test('meta do dia redistribui o que sobrou pelos dias restantes', () => {
  // hoje = 15/09, ciclo 01/09 a 30/09 → 16 dias restantes (inclui hoje)
  const app = load({ today: '2026-09-15T12:00:00' });
  app.setState({
    startDate: '2026-09-01', endDate: '2026-09-30', monthlyLimit: 3000, initialSpent: 100,
    expenses: [exp(1, '2026-09-05', 500), exp(2, '2026-09-14', 300), exp(3, '2026-09-15', 80)]
  });
  app.fn('renderCartao')();
  const brl = app.fn('formatBRL');
  const n = s => s.replace(/ /g, ' ');
  // gasto antes de hoje = 100 (inicial) + 500 + 300 = 900; meta = (3000 − 900) / 16 = 131,25
  assert.equal(app.text('spentDisplay'), n(brl(980)));
  assert.equal(app.text('remainingDisplay'), n(brl(2020)));
  assert.equal(app.text('dailyAvailable'), n(brl(131.25 - 80)));
  assert.match(app.text('daysLeftInfo'), /16 dias restantes/);
  assert.equal(app.text('percentDisplay'), '33%');
  assert.equal(app.text('progressStatusText'), 'Dentro do planejado');
});

test('teto estourado mostra o quanto passou', () => {
  const app = load({ today: '2026-09-15T12:00:00' });
  app.setState({ startDate: '2026-09-01', endDate: '2026-09-30', monthlyLimit: 1000, expenses: [exp(1, '2026-09-02', 1200)] });
  app.fn('renderCartao')();
  assert.match(app.text('progressStatusText'), /Teto estourado em R\$ 200,00/);
});

test('duplicata hoje só é sinalizada com data, valor e descrição idênticos', () => {
  const app = load();
  const dup = app.fn('flagPossibleDuplicates');
  const igual = dup([exp(1, '2026-09-11', 24.29, { desc: 'Almoço' }), exp(2, '2026-09-11', 24.29, { desc: ' almoço ' })]);
  assert.deepEqual([...igual].sort(), ['1', '2']);
  // Casos reais de 09/2026 que passaram despercebidos (comportamento atual, a melhorar):
  const descDiferente = dup([exp(1, '2026-09-11', 24.29, { desc: 'Almoço' }), exp(2, '2026-09-11', 24.29, { desc: 'Della almoço?' })]);
  assert.equal(descDiferente.size, 0);
  const dataDiferente = dup([exp(1, '2026-09-04', 100, { desc: 'Etanol dia 6' }), exp(2, '2026-09-06', 100, { desc: 'Combustível' })]);
  assert.equal(dataDiferente.size, 0);
});

test('lista ordena por data decrescente, mantendo a ordem de digitação no mesmo dia', () => {
  const app = load();
  const list = [exp('a', '2026-09-10', 1), exp('b', '2026-09-12', 1), exp('c', '2026-09-10', 1)];
  assert.deepEqual([...app.fn('sortExpensesByDate')(list).map(e => e.id)], ['b', 'a', 'c']);
});

test('aviso de fatura do cartão principal compara sem diferenciar maiúsculas', () => {
  const app = load();
  app.setState({ cardInvoiceName: 'Cartão Visa' });
  assert.equal(app.fn('matchesCardInvoice')('Pagamento cartão visa setembro'), true);
  assert.equal(app.fn('matchesCardInvoice')('Cartão Nubank'), false);
  app.setState({ cardInvoiceName: '' });
  assert.equal(app.fn('matchesCardInvoice')('Cartão Visa'), false);
});
