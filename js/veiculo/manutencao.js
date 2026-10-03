import { pushConfig } from '../ajustes.js';
import { commit } from '../app.js';
import { getOdometer, state, sumPartials } from '../estado.js';
import { closeModal, openModal } from '../modal.js';
import { queueHist, queueMaint, queueMaintDelete } from '../sync.js';
import { $, el, fmtDateBR, fmtN, formatBRL, parseNum, sanitizeDateStr, showToast, toInputNum, todayISO, uid } from '../util.js';
import { maintExpenseId, segValue, setSeg, syncLinkUI, upsertLinkedExpense } from './vinculo.js';

/* ─── Hodômetro ─── */
let pendingOdo = null;
function cancelOdometer() { pendingOdo = null; }
function askOdometer() {
  const v = parseNum($('inputOdo').value);
  if (isNaN(v) || v < 0) return showToast('⚠️ Valor inválido', { error: true });
  pendingOdo = v;
  $('odoConfirmVal').textContent = fmtN(v, 0) + ' km';
  openModal('odoModal');
}
function confirmOdometer() {
  if (pendingOdo === null) return;
  state.odoBase = Math.max(0, pendingOdo - sumPartials());
  pendingOdo = null;
  $('inputOdo').value = '';
  closeModal('odoModal');
  pushConfig();
  commit();
  showToast('✅ Hodômetro atualizado.');
}

/* ─── Manutenção ─── */
function saveMaint() {
  const name = $('mName').value.trim();
  const interval = parseNum($('mInterval').value);
  const lastOdo = parseNum($('mLastOdo').value) || 0;
  const warnKm = parseNum($('mWarn').value) || 500;
  const cost = parseNum($('mCost').value) || 0;
  if (!name) return showToast('⚠️ Informe o nome', { error: true });
  if (!interval || interval < 1) return showToast('⚠️ Informe o intervalo em km', { error: true });
  const m = { id: uid(), name, interval, lastOdo, warnKm, cost, history: [] };
  state.maintenances.push(m);
  queueMaint(m);
  ['mName', 'mInterval', 'mLastOdo', 'mCost'].forEach(x => $(x).value = '');
  $('mWarn').value = '500';
  commit();
  showToast('🔧 Alerta cadastrado.');
}
function deleteMaint(id) {
  if (!confirm('Excluir este alerta e seu histórico? Despesas já lançadas continuam no Gastos.')) return;
  state.maintenances = state.maintenances.filter(m => m.id !== id);
  queueMaintDelete(id);
  commit();
}
function openMaintDone(id) {
  const m = state.maintenances.find(x => x.id === id);
  if (!m) return;
  $('maintDoneId').value = id;
  $('maintDoneName').textContent = '✅ ' + m.name;
  $('doneOdo').value = getOdometer() || '';
  $('doneDate').value = todayISO();
  $('doneCost').value = toInputNum(m.cost || '');
  $('doneNote').value = '';
  $('doneOdoHint').textContent = 'Hodômetro atual: ' + fmtN(getOdometer(), 0) + ' km';
  $('doneLinkExpense').checked = true;
  setSeg('doneLinkCiclo', state.fuelCiclo || 'cartao');
  syncLinkUI('doneLinkExpense', 'doneLinkCiclo');
  openModal('maintDoneModal');
}
function confirmMaintDone() {
  const m = state.maintenances.find(x => x.id === $('maintDoneId').value);
  const odo = parseNum($('doneOdo').value);
  if (!m) return;
  if (isNaN(odo) || odo < 0) return showToast('⚠️ Informe o hodômetro', { error: true });
  const date = sanitizeDateStr($('doneDate').value) || todayISO();
  const cost = parseNum($('doneCost').value) || 0;
  const link = $('doneLinkExpense').checked && cost > 0;
  const ciclo = segValue('doneLinkCiclo');
  const h = { id: uid(), date, odo, cost, note: $('doneNote').value.trim(), expenseCiclo: link ? ciclo : '' };
  m.history.unshift(h);
  m.lastOdo = odo;
  if (link) upsertLinkedExpense({ id: maintExpenseId(h.id), origem: 'manutencao:' + m.id, date, desc: `Manutenção · ${m.name}`, value: cost, ciclo });
  queueMaint(m);
  queueHist(m.id, h);
  closeModal('maintDoneModal');
  commit();
  showToast(link ? '✅ Manutenção registrada e lançada como despesa.' : '✅ Manutenção registrada.');
}

function renderMaint() {
  const box = $('maintList');
  box.innerHTML = '';
  if (!state.maintenances.length) { box.append(el('div', { class: 'card empty' }, 'Nenhum alerta cadastrado.')); return; }
  state.maintenances.forEach(m => {
    const next = m.lastOdo + m.interval;
    const rem = next - getOdometer();
    let color, badge;
    if (rem <= 0) { color = 'var(--danger)'; badge = el('span', { class: 'tag danger' }, '⚠️ VENCIDA'); }
    else if (rem <= m.warnKm) { color = 'var(--warning)'; badge = el('span', { class: 'tag warn' }, `⚡ faltam ${fmtN(rem, 0)} km`); }
    else { color = 'var(--success)'; badge = el('span', { class: 'tag ok' }, `✓ ${fmtN(rem, 0)} km restantes`); }
    const pct = Math.max(0, Math.min(100, ((getOdometer() - m.lastOdo) / m.interval) * 100));
    const card = el('div', { class: 'alert-card', style: `--ac:${color}` },
      el('div', { class: 'alert-name' }, m.name),
      el('div', { class: 'alert-meta' }, `A cada ${fmtN(m.interval, 0)} km · última em ${fmtN(m.lastOdo, 0)} km · próxima em ${fmtN(next, 0)} km` + (m.cost ? ` · est. ${formatBRL(m.cost)}` : '')),
      badge,
      el('div', { class: 'bar', style: 'margin-top:10px;height:6px' }, el('i', { style: `width:${pct.toFixed(0)}%;background:${color}` })),
      el('div', { class: 'card-actions' },
        el('button', { class: 'btn sm', onclick: () => openMaintDone(m.id) }, '✅ Realizada'),
        el('button', { class: 'btn sm danger', onclick: () => deleteMaint(m.id) }, '🗑 Excluir')));
    if (m.history.length) {
      const hist = el('div', { style: 'margin-top:10px' }, el('div', { class: 'section-label', style: 'margin-bottom:4px' }, 'Histórico'));
      m.history.forEach(h => hist.append(el('div', { class: 'hist-line' },
        el('div', {}, `${fmtDateBR(h.date)} · ${fmtN(h.odo, 0)} km`, h.note ? el('div', { style: 'font-size:.7rem' }, h.note) : null),
        el('div', { style: 'text-align:right' }, h.cost ? formatBRL(h.cost) : '', h.expenseCiclo ? el('div', { style: 'font-size:.66rem' }, h.expenseCiclo === 'contas' ? '🧾 Contas' : '💳 Cartão') : null))));
      hist.append(el('div', { class: 'small muted', style: 'margin-top:6px' }, `Total gasto: ${formatBRL(m.history.reduce((a, h) => a + (h.cost || 0), 0))}`));
      card.append(hist);
    }
    box.append(card);
  });
}

export { askOdometer, cancelOdometer, confirmMaintDone, confirmOdometer, deleteMaint, openMaintDone, pendingOdo, renderMaint, saveMaint };
