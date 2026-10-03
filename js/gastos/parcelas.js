import { commit } from '../app.js';
import { state } from '../estado.js';
import { addMonths, addMonthsDate } from './comum.js';
import { syncExpense } from '../sync.js';
import { $, formatBRL, monthShort, showToast, uid } from '../util.js';

/* ════════════ PARCELAMENTO (Contas e Cartão) ════════════ */
function readParcelamento(prefix) {
  if (!$(prefix + 'ParcOn').checked) return null;
  const total = parseInt($(prefix + 'ParcN').value, 10);
  if (!(total >= 2 && total <= 72)) { showToast('Informe o número de parcelas (2 a 72).', { error: true }); return false; }
  return { total, valueIsTotal: $(prefix + 'ParcMode').value === 'total' };
}
function resetParcelamento(prefix) {
  $(prefix + 'ParcOn').checked = false;
  $(prefix + 'ParcN').value = '';
  $(prefix + 'ParcMode').value = 'parcela';
  $(prefix + 'ParcFields').classList.add('hidden');
}
// Gera todas as parcelas de uma vez, uma por mês (data e competência avançam juntas)
function addParcelas({ desc, cat, date, competencia, value, ciclo, fixedId, total, valueIsTotal }) {
  const group = uid();
  const cents = Math.round(value * 100);
  const per = valueIsTotal ? Math.floor(cents / total) : cents;
  const base = Date.now();
  const created = [];
  for (let i = 0; i < total; i++) {
    const v = valueIsTotal && i === total - 1 ? cents - per * (total - 1) : per;
    const exp = {
      id: String(base + i), date: addMonthsDate(date, i), desc: `${desc} (parc ${i + 1}/${total})`, cat,
      value: v / 100, ciclo, competencia: addMonths(competencia, i), fixedId, origem: `parcela:${group}:${i + 1}/${total}`
    };
    state.expenses.push(exp);
    created.push(exp);
  }
  commit();
  (async () => { for (const e of created) await syncExpense('addExpense', e, { silent: true }); })();
  showToast(`🧩 ${total} parcelas de ${formatBRL(per / 100)} lançadas (${monthShort(competencia)} a ${monthShort(addMonths(competencia, total - 1))}).`, { duration: 5000 });
}

export { addParcelas, readParcelamento, resetParcelamento };
