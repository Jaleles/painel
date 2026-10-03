import { commit, switchView } from '../app.js';
import { state } from '../estado.js';
import { activeFixasFor, addMonths, currentMonth, dateInComp, expenseCompetencia, fillList, matchesCardInvoice, sumValues } from './comum.js';
import { addParcelas, readParcelamento, resetParcelamento } from './parcelas.js';
import { drawChart } from '../graficos.js';
import { pendingCount, syncExpense } from '../sync.js';
import { $, compactBRL, el, esc, formatBRL, monthLabel, monthShort, parseMoneyInput, round2, sanitizeDateStr, showToast, toInputNum, todayISO, vibrate } from '../util.js';

/* ════════════ CONTAS ════════════
   A tela abre no mês corrente. Quando todas as fixas do mês já foram lançadas,
   ela avança para o mês seguinte (o que ainda falta pagar). */
let editingBillId = null;
let currentBillsCompetencia = null;
function autoBillsCompetencia() {
  const cur = currentMonth();
  const act = activeFixasFor(cur);
  if (act.length && !pendingFixasFor(cur).length) return addMonths(cur, 1);
  return cur;
}
const billsExpensesFor = comp => state.expenses.filter(e => e.ciclo === 'contas' && expenseCompetencia(e) === comp);
function pendingFixasFor(comp) {
  const launched = new Set(billsExpensesFor(comp).filter(e => e.fixedId).map(e => String(e.fixedId)));
  return activeFixasFor(comp).filter(f => !launched.has(String(f.id)));
}
function lastFixaValue(f, beforeComp) {
  const prev = state.expenses
    .filter(e => e.ciclo === 'contas' && String(e.fixedId) === String(f.id) && expenseCompetencia(e) < beforeComp)
    .sort((a, b) => expenseCompetencia(a).localeCompare(expenseCompetencia(b))).pop();
  return prev ? prev.value : (Number(f.refValue) || 0);
}
// Projeção = fixas (lançadas ou estimadas pelo último valor pago) + avulsos/parcelas já lançados
function billsProjection(comp) {
  const items = billsExpensesFor(comp);
  const spent = sumValues(items);
  const pending = pendingFixasFor(comp);
  const pendingEstimate = pending.reduce((a, f) => a + lastFixaValue(f, comp), 0);
  const fixasLaunched = sumValues(items.filter(e => e.fixedId));
  return { spent, fixasLaunched, avulsos: spent - fixasLaunched, pendingCount: pending.length, pendingEstimate, total: spent + pendingEstimate };
}
// Volta para a competência automática (mês corrente ou o seguinte, se as fixas já foram lançadas)
function resetBillsCompetencia() { currentBillsCompetencia = autoBillsCompetencia(); return currentBillsCompetencia; }
function shiftBillsCompetencia(delta) {
  currentBillsCompetencia = addMonths(currentBillsCompetencia, delta);
  if (!editingBillId) $('billCompetencia').value = currentBillsCompetencia;
  renderContas(); renderContasChart();
}

function renderContas() {
  if (!currentBillsCompetencia) currentBillsCompetencia = autoBillsCompetencia();
  const comp = currentBillsCompetencia;
  const items = billsExpensesFor(comp);
  const proj = billsProjection(comp);
  const act = activeFixasFor(comp);
  const isAuto = comp === autoBillsCompetencia();
  const isThisMonth = comp === currentMonth();

  $('billsCompetenciaLabel').textContent = monthLabel(comp);
  $('btnTodayBillsCycle').style.visibility = isAuto ? 'hidden' : 'visible';
  $('billsTotalValue').textContent = formatBRL(proj.spent);
  const days = act.map(f => f.dueDay).filter(Boolean).sort((a, b) => a - b);
  const parts = [`${act.length - proj.pendingCount} de ${act.length} fixa(s) lançada(s)`];
  if (days.length) parts.push(days[0] === days[days.length - 1] ? `vencimento dia ${days[0]}` : `vencimentos dia ${days[0]} a ${days[days.length - 1]}`);
  $('billsCycleInfo').innerHTML = esc(parts.join(' · ')) +
    (proj.pendingCount ? `<br>Previsto para o mês: <strong>${esc(formatBRL(proj.total))}</strong> (faltam ~${esc(formatBRL(proj.pendingEstimate))})` : '');

  // Avisos: pendentes desta competência + mês anterior esquecido
  const banner = $('billsPendingBanner');
  const msgs = [];
  if (proj.pendingCount) {
    const pending = pendingFixasFor(comp);
    const todayDay = new Date().getDate();
    const urgent = isThisMonth ? pending.filter(f => f.dueDay && (f.dueDay - todayDay) <= 3) : [];
    msgs.push(urgent.length
      ? `⚠️ ${pending.length} pendente(s) — ${urgent.map(f => f.desc + (f.dueDay < todayDay ? ' (vencida)' : '')).join(', ')} vence(m) em breve!`
      : `⚠️ ${pending.length} despesa(s) fixa(s) ainda não lançada(s) nesta competência.`);
  }
  const prevComp = addMonths(currentMonth(), -1);
  const prevPending = comp !== prevComp ? pendingFixasFor(prevComp) : [];
  banner.innerHTML = '';
  msgs.forEach(m => banner.append(el('div', {}, m)));
  if (prevPending.length) {
    banner.append(el('div', { style: msgs.length ? 'margin-top:6px' : '' },
      `📌 ${monthLabel(prevComp)} ainda tem ${prevPending.length} fixa(s) sem lançamento (${prevPending.map(f => f.desc).join(', ')}). `,
      el('button', { class: 'link-btn', style: 'color:inherit;text-decoration:underline', onclick: () => { currentBillsCompetencia = prevComp; shiftBillsCompetencia(0); } }, 'Ver')));
  }
  banner.classList.toggle('show', !!(msgs.length || prevPending.length));

  const launched = new Set(items.filter(e => e.fixedId).map(e => String(e.fixedId)));
  const list = $('fixedItemsList');
  list.innerHTML = '';
  if (!act.length) {
    list.append(el('div', { class: 'empty' }, state.fixedItems.length ? 'Nenhuma fixa ativa nesta competência.' : 'Nenhuma despesa fixa cadastrada. Cadastre em Ajustes ⚙️.'));
  } else {
    act.forEach(f => {
      const done = launched.has(String(f.id));
      const launchedItem = done ? items.find(e => String(e.fixedId) === String(f.id)) : null;
      const sub = `${done ? 'Ref.' : 'Estimado'} ${formatBRL(done ? f.refValue : lastFixaValue(f, comp))}${f.dueDay ? ' · vence dia ' + f.dueDay : ''}`;
      list.append(el('div', { class: 'item' + (done ? '' : ' pending') },
        el('div', { class: 'item-info' },
          el('span', { class: 'item-title' }, f.desc),
          el('div', { class: 'item-sub' }, sub, matchesCardInvoice(f.desc) ? el('span', { class: 'tag danger' }, '⚠️ fatura do cartão principal') : null)),
        el('div', { class: 'item-right' },
          done ? el('span', { class: 'tag ok' }, '✓ ' + formatBRL(launchedItem ? launchedItem.value : 0))
               : el('button', { class: 'btn sm', onclick: () => quickLaunchFixed(f) }, 'Lançar'))
      ));
    });
  }

  fillList($('billsExpenseList'), items, 'Nenhuma despesa lançada nesta competência.', { onEdit: startEditBillExpense, flagDup: true });
}

function renderContasChart() {
  const g = {};
  state.expenses.forEach(e => { if (e.ciclo === 'contas') { const c = expenseCompetencia(e); if (c) g[c] = (g[c] || 0) + e.value; } });
  const cur = currentMonth();
  const months = Object.keys(g).filter(m => m <= addMonths(cur, 3)).sort().slice(-8);
  drawChart($('chartContas'), {
    type: 'bar', labels: months.map(monthShort), tipLabels: months.map(m => monthLabel(m) + (m > cur ? ' (futuro: parcelas já lançadas)' : '')),
    series: [{ name: 'Total', values: months.map(m => g[m]), color: 'var(--c-contas)', colors: months.map(m => m > cur ? 'var(--faint)' : 'var(--c-contas)') }],
    fmt: formatBRL, axisFmt: compactBRL
  });
}

function quickLaunchFixed(f) {
  const comp = currentBillsCompetencia || autoBillsCompetencia();
  cancelEditBill();
  $('billDesc').value = f.desc;
  $('billVal').value = toInputNum(lastFixaValue(f, comp));
  if (![...$('billCat').options].some(o => o.value === f.desc)) $('billCat').append(el('option', { value: f.desc }, f.desc));
  $('billCat').value = f.desc;
  $('billDate').value = comp === currentMonth() ? todayISO() : dateInComp(comp, f.dueDay);
  $('billCompetencia').value = comp;
  $('billFixedId').value = f.id;
  $('billParcBox').classList.add('hidden');
  $('billsForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => $('billVal').select(), 250);
  showToast(`Confirme o valor de "${f.desc}" e lance.`);
}

function startEditBillExpense(id) {
  const it = state.expenses.find(e => e.id === String(id));
  if (!it) return;
  editingBillId = it.id;
  switchView('contas');
  $('billDesc').value = it.desc;
  $('billVal').value = toInputNum(it.value);
  if (![...$('billCat').options].some(o => o.value === it.cat)) $('billCat').append(el('option', { value: it.cat }, it.cat));
  $('billCat').value = it.cat;
  $('billDate').value = it.date;
  $('billCompetencia').value = expenseCompetencia(it);
  $('billFixedId').value = it.fixedId || '';
  $('billsFormTitle').textContent = '✏️ Editar despesa (Contas)';
  $('btnSubmitBill').textContent = 'Salvar alteração';
  $('btnCancelEditBill').classList.remove('hidden');
  resetParcelamento('bill'); $('billParcBox').classList.add('hidden');
  $('billsForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function cancelEditBill() {
  editingBillId = null;
  $('billsForm').reset();
  $('billDate').value = todayISO();
  $('billCompetencia').value = currentBillsCompetencia || autoBillsCompetencia();
  $('billFixedId').value = '';
  $('billsFormTitle').textContent = '➕ Lançar despesa (Contas)';
  $('btnSubmitBill').textContent = 'Lançar despesa';
  $('btnCancelEditBill').classList.add('hidden');
  resetParcelamento('bill'); $('billParcBox').classList.remove('hidden');
}

function onSubmitBill(ev) {
  ev.preventDefault();
  const desc = $('billDesc').value.trim();
  const value = parseMoneyInput($('billVal').value);
  const cat = $('billCat').value;
  const date = sanitizeDateStr($('billDate').value);
  const competencia = $('billCompetencia').value;
  const fixedId = $('billFixedId').value || null;
  if (!desc) return showToast('Informe uma descrição.', { error: true });
  if (isNaN(value) || value <= 0) return showToast('Informe um valor válido (ex: 45,90).', { error: true });
  if (!date) return showToast('Informe uma data válida.', { error: true });
  if (!competencia) return showToast('Informe a competência (mês/ano).', { error: true });
  if (matchesCardInvoice(desc, cat) && !confirm(`"${desc}" parece ser a fatura do cartão principal (${state.cardInvoiceName}).\n\nOs gastos desse cartão já entram no ciclo Cartão — lançar a fatura aqui conta em dobro no Teto Total.\n\nLançar mesmo assim?`)) return;

  if (editingBillId) {
    const idx = state.expenses.findIndex(e => e.id === editingBillId);
    if (idx >= 0) {
      const upd = { ...state.expenses[idx], date, desc, cat, value: round2(value), ciclo: 'contas', fixedId, competencia };
      state.expenses[idx] = upd;
      commit();
      syncExpense('updateExpense', upd);
      showToast('Despesa atualizada.');
    }
  } else {
    const parc = fixedId ? null : readParcelamento('bill');
    if (parc === false) return;
    if (parc) addParcelas({ desc, cat, date, competencia, value, ciclo: 'contas', fixedId: null, ...parc });
    else {
      const exp = { id: String(Date.now()), date, desc, cat, value: round2(value), ciclo: 'contas', fixedId, competencia, origem: '' };
      state.expenses.push(exp);
      commit();
      syncExpense('addExpense', exp);
      showToast('Despesa lançada no ciclo Contas.');
    }
    vibrate(25);
  }
  cancelEditBill();
}

export { autoBillsCompetencia, billsExpensesFor, billsProjection, cancelEditBill, currentBillsCompetencia, editingBillId, lastFixaValue, onSubmitBill, pendingFixasFor, quickLaunchFixed, renderContas, renderContasChart, resetBillsCompetencia, shiftBillsCompetencia, startEditBillExpense };
