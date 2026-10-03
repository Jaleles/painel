import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const app = load();

test('parseMoneyInput aceita os formatos digitados e os vindos da planilha', () => {
  const p = app.fn('parseMoneyInput');
  assert.equal(p('1.234,56'), 1234.56);
  assert.equal(p('45,9'), 45.9);
  assert.equal(p('45.90'), 45.9);
  assert.equal(p('45'), 45);
  assert.equal(p('R$ 6,00'), 6);
  assert.ok(Number.isNaN(p('')));
  assert.ok(Number.isNaN(p(null)));
});

test('sanitizeDateStr normaliza datas para AAAA-MM-DD', () => {
  const s = app.fn('sanitizeDateStr');
  assert.equal(s('26/09/2026'), '2026-09-26');
  assert.equal(s('1/9/2026'), '2026-09-01');
  assert.equal(s('2026-09-26'), '2026-09-26');
  assert.equal(s('2026-09-26T03:00:00.000Z'), '2026-09-26');
  assert.equal(s('26-09-2026'), '2026-09-26');
  // bug herdado do FuelTrack: datas convertidas pelo Sheets em texto longo
  assert.equal(s('Tue Sep 01 2026 00:00:00 GMT-0300'), '2026-09-01');
  assert.equal(s(''), '');
});

test('normMonth normaliza competência e usa a data como reserva', () => {
  const n = app.fn('normMonth');
  assert.equal(n('2026-09'), '2026-09');
  assert.equal(n('9/2026'), '2026-09');
  assert.equal(n('26/09/2026'), '2026-09');
  assert.equal(n('', '28/09/2026'), '2026-09');
  assert.equal(n(''), '');
});

test('addMonths e addMonthsDate atravessam o ano e respeitam o fim do mês', () => {
  assert.equal(app.fn('addMonths')('2026-11', 3), '2027-02');
  assert.equal(app.fn('addMonths')('2026-01', -1), '2025-12');
  assert.equal(app.fn('addMonthsDate')('2026-01-31', 1), '2026-02-28');
  assert.equal(app.fn('addMonthsDate')('2026-08-31', 1), '2026-09-30');
  assert.equal(app.fn('dateInComp')('2026-02', 31), '2026-02-28');
  assert.equal(app.fn('dateInComp')('2026-09', 10), '2026-09-10');
});

test('esc impede HTML em textos digitados (correção de XSS herdada)', () => {
  assert.equal(app.fn('esc')('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});

test('normalizeExpense preenche padrões e deriva a competência da data', () => {
  const e = app.fn('normalizeExpense')({ id: 1, date: '28/09/2026', value: '150', ciclo: 'qualquer' });
  assert.equal(e.id, '1');
  assert.equal(e.date, '2026-09-28');
  assert.equal(e.value, 150);
  assert.equal(e.ciclo, 'cartao');
  assert.equal(e.competencia, '2026-09');
  assert.equal(e.desc, 'Sem descrição');
  assert.equal(e.cat, 'Outros');
  assert.equal(e.fixedId, null);
});
