import { commit, switchView } from '../app.js';
import { state, ui } from '../estado.js';
import { expenseCompetencia, fillList } from './comum.js';
import { addParcelas, readParcelamento, resetParcelamento } from './parcelas.js';
import { drawChart } from '../graficos.js';
import { syncExpense } from '../sync.js';
import { $, compactBRL, el, esc, fmtDM, fmtDateBR, formatBRL, parseMoneyInput, round2, sanitizeDateStr, showToast, toISODate, toInputNum, todayISO, vibrate } from '../util.js';

/* ════════════ CARTÃO ════════════ */
let editingId = null;
function cartaoCycleExpenses() {
  return state.expenses.filter(e => e.ciclo === 'cartao' && e.date >= state.startDate && e.date <= state.endDate);
}

function renderCartao() {
  const limit = Number(state.monthlyLimit || 0);
  const start = new Date(state.startDate + 'T00:00:00');
  const end = new Date(state.endDate + 'T23:59:59');
  const now = new Date();
  const DAY = 86400000;
  const totalCycleDays = Math.max(1, Math.round((end - start) / DAY));
  let remainingDays;
  if (now < start) remainingDays = totalCycleDays;
  else if (now > end) remainingDays = 1;
  else remainingDays = Math.max(1, Math.ceil((end - now) / DAY));

  const today = todayISO();
  const cycleExpenses = cartaoCycleExpenses();
  let spentToday = 0, spentBefore = Number(state.initialSpent || 0);
  cycleExpenses.forEach(e => { if (e.date === today) spentToday += e.value; else spentBefore += e.value; });

  const total = spentBefore + spentToday;
  const remaining = limit - total;
  const dailyBudget = (limit - spentBefore) / remainingDays;
  const todayBalance = dailyBudget - spentToday;

  $('limitDisplay').textContent = formatBRL(limit);
  $('spentDisplay').textContent = formatBRL(total);
  $('remainingDisplay').textContent = formatBRL(remaining);
  $('remainingDisplay').style.color = remaining < 0 ? 'var(--danger)' : 'var(--success)';
  const hv = $('dailyAvailable');
  hv.textContent = formatBRL(todayBalance);
  hv.classList.toggle('neg', todayBalance < 0);
  $('daysLeftInfo').innerHTML =
    `Meta do dia <strong>${esc(formatBRL(dailyBudget))}</strong> · gasto hoje <strong>${esc(formatBRL(spentToday))}</strong><br>` +
    `${remainingDays} ${remainingDays === 1 ? 'dia restante' : 'dias restantes'} · ciclo ${fmtDM(state.startDate)} a ${fmtDM(state.endDate)}`;

  const pct = limit > 0 ? (total / limit) * 100 : 0;
  $('percentDisplay').textContent = `${pct.toFixed(0)}%`;
  const bar = $('progressBar');
  bar.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
  const st = $('progressStatusText');
  if (pct > 100) { bar.style.background = 'var(--danger)'; st.textContent = `Teto estourado em ${formatBRL(Math.abs(remaining))}`; st.style.color = 'var(--danger)'; }
  else if (pct >= 80) { bar.style.background = 'var(--warning)'; st.textContent = 'Atenção ao limite!'; st.style.color = 'var(--warning)'; }
  else { bar.style.background = 'var(--c-cartao)'; st.textContent = 'Dentro do planejado'; st.style.color = ''; }

  $('cartaoCount').textContent = cycleExpenses.length ? `${cycleExpenses.length} lançamento(s)` : '';
  fillList($('currentExpenseList'), cycleExpenses, 'Nenhum gasto registrado neste ciclo.', { onEdit: startEditExpense, flagDup: true });
}

function renderCartaoChart() {
  const container = $('chartCartao');
  const mode = ui.cartaoChart === 'acumulado' ? 'acumulado' : 'diario';
  $('cartaoChartMode').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const days = [];
  const cur = new Date(state.startDate + 'T00:00:00');
  const end = new Date(state.endDate + 'T00:00:00');
  let guard = 0;
  while (cur <= end && guard++ < 120) { days.push(toISODate(cur)); cur.setDate(cur.getDate() + 1); }
  if (!days.length) { container.innerHTML = '<div class="empty">Datas do ciclo inválidas.</div>'; return; }

  const daily = Object.fromEntries(days.map(d => [d, 0]));
  cartaoCycleExpenses().forEach(e => { if (daily[e.date] !== undefined) daily[e.date] += e.value; });
  const today = todayISO();
  const limit = Number(state.monthlyLimit || 0);
  const initial = Number(state.initialSpent || 0);
  const pastDays = days.filter(d => d <= today);
  const legend = $('cartaoChartLegend');
  const note = $('cartaoChartNote');
  $('cartaoChartInfo').textContent = limit ? `teto ${compactBRL(limit)}` : '';

  if (mode === 'diario') {
    const meta = limit / days.length;                       // teto ÷ dias do ciclo
    const spentPast = pastDays.reduce((a, d) => a + daily[d], 0);
    const avg = pastDays.length ? spentPast / pastDays.length : null; // média real até hoje
    const values = days.map(d => d <= today ? daily[d] : null);
    const colors = days.map(d => (limit && daily[d] > meta) ? 'var(--warning)' : 'var(--c-cartao)');
    const series = [{ name: 'Gasto no dia', values, color: 'var(--c-cartao)', colors }];
    if (limit) series.push({ name: 'Meta diária', values: days.map(() => meta), color: 'var(--faint)', flat: true, dashed: true });
    if (avg !== null) series.push({ name: 'Sua média', values: days.map(() => avg), color: 'var(--c-teto)', flat: true });
    drawChart(container, { type: 'bar', labels: days.map(fmtDM), tipLabels: days.map(fmtDateBR), series, fmt: formatBRL, axisFmt: compactBRL });

    legend.innerHTML = '';
    legend.append(el('span', { style: '--lg-c: var(--c-cartao)' }, 'Gasto no dia'));
    if (limit) legend.append(el('span', { style: '--lg-c: var(--warning)' }, 'Acima da meta'),
                             el('span', { class: 'dashed', style: '--lg-c: var(--faint)' }, 'Meta diária'));
    if (avg !== null) legend.append(el('span', { style: '--lg-c: var(--c-teto)' }, 'Sua média'));

    const above = pastDays.filter(d => limit && daily[d] > meta).length;
    const peak = pastDays.reduce((best, d) => (!best || daily[d] > daily[best]) ? d : best, null);
    const parts = [];
    if (avg !== null) parts.push(`Média ${formatBRL(avg)}/dia` + (limit ? ` · meta ${formatBRL(meta)}/dia` : ''));
    if (limit && pastDays.length) parts.push(`${above} de ${pastDays.length} dia(s) acima da meta`);
    if (peak && daily[peak] > 0) parts.push(`maior gasto: ${fmtDM(peak)} (${formatBRL(daily[peak])})`);
    if (initial) parts.push(`gasto inicial de ${formatBRL(initial)} não aparece nas barras`);
    note.textContent = parts.join(' · ');
  } else {
    let acc = initial;
    const accum = days.map(d => { acc += daily[d]; return d <= today ? acc : null; });
    const ideal = days.map((_, i) => limit * (i + 1) / days.length);
    drawChart(container, {
      labels: days.map(fmtDM),
      tipLabels: days.map(d => `${fmtDM(d)} · gasto no dia ${formatBRL(daily[d])}`),
      series: [
        { name: 'Acumulado', values: accum, color: 'var(--c-cartao)', fill: true },
        { name: 'Ideal', values: ideal, color: 'var(--faint)', dashed: true }
      ],
      fmt: formatBRL, axisFmt: compactBRL
    });
    legend.innerHTML = '';
    legend.append(el('span', { style: '--lg-c: var(--c-cartao)' }, 'Gasto acumulado'),
                  el('span', { class: 'dashed', style: '--lg-c: var(--faint)' }, 'Ritmo ideal'));
    const idx = days.indexOf(pastDays[pastDays.length - 1]);
    if (idx >= 0 && limit) {
      const diff = accum[idx] - ideal[idx];
      note.textContent = diff > 0 ? `Você está ${formatBRL(diff)} acima do ritmo ideal para hoje.` : `Você está ${formatBRL(-diff)} abaixo do ritmo ideal para hoje.`;
    } else note.textContent = '';
  }
}

function startEditExpense(id) {
  const it = state.expenses.find(e => e.id === String(id));
  if (!it) return;
  editingId = it.id;
  $('expDesc').value = it.desc;
  $('expVal').value = toInputNum(it.value);
  if (![...$('expCat').options].some(o => o.value === it.cat)) $('expCat').append(el('option', { value: it.cat }, it.cat));
  $('expCat').value = it.cat; // mantém a categoria original (antes virava "Outros" ao editar)
  $('expDate').value = it.date;
  $('expCompetencia').value = expenseCompetencia(it);
  $('formTitle').textContent = '✏️ Editar despesa';
  $('editHint').style.display = 'block';
  $('btnSubmitExpense').textContent = 'Salvar alteração';
  $('btnCancelEdit').classList.remove('hidden');
  resetParcelamento('exp'); $('expParcBox').classList.add('hidden');
  switchView('cartao');
  $('expDesc').focus();
}
function cancelEdit() {
  editingId = null;
  $('expenseForm').reset();
  $('expDate').value = todayISO();
  $('expCompetencia').value = todayISO().slice(0, 7);
  $('formTitle').textContent = '➕ Adicionar despesa';
  $('editHint').style.display = 'none';
  $('btnSubmitExpense').textContent = 'Registrar gasto';
  $('btnCancelEdit').classList.add('hidden');
  $('expParcBox').classList.remove('hidden');
}

function onSubmitExpense(ev) {
  ev.preventDefault();
  const desc = $('expDesc').value.trim();
  const value = parseMoneyInput($('expVal').value);
  const cat = $('expCat').value;
  const date = sanitizeDateStr($('expDate').value);
  const competencia = $('expCompetencia').value || date.slice(0, 7);
  if (!desc) return showToast('Informe uma descrição.', { error: true });
  if (isNaN(value) || value <= 0) return showToast('Informe um valor válido (ex: 45,90).', { error: true });
  if (!date) return showToast('Informe uma data válida.', { error: true });

  if (editingId) {
    const idx = state.expenses.findIndex(e => e.id === editingId);
    if (idx >= 0) {
      const upd = { ...state.expenses[idx], date, desc, cat, value: round2(value), ciclo: 'cartao', competencia };
      state.expenses[idx] = upd;
      commit();
      syncExpense('updateExpense', upd);
      showToast('Despesa atualizada.');
    }
    cancelEdit();
  } else {
    const parc = readParcelamento('exp');
    if (parc === false) return;
    if (parc) {
      addParcelas({ desc, cat, date, competencia, value, ciclo: 'cartao', fixedId: null, ...parc });
      resetParcelamento('exp');
    } else {
      const exp = { id: String(Date.now()), date, desc, cat, value: round2(value), ciclo: 'cartao', competencia, fixedId: null, origem: '' };
      state.expenses.push(exp);
      commit();
      syncExpense('addExpense', exp);
    }
    vibrate(25);
    $('expDesc').value = ''; $('expVal').value = '';
    $('expDesc').focus();
  }
}

export { cancelEdit, cartaoCycleExpenses, editingId, onSubmitExpense, renderCartao, renderCartaoChart, startEditExpense };
