import { pushConfig } from '../ajustes.js';
import { commit } from '../app.js';
import { getOdometer, state, sumPartials } from '../estado.js';
import { addParcelas } from '../gastos/parcelas.js';
import { closeModal, openModal } from '../modal.js';
import { queueHist, queueHistDelete, queueMaint, queueMaintDelete } from '../sync.js';
import { $, el, fmtDateBR, fmtN, formatBRL, parseNum, sanitizeDateStr, showToast, toInputNum, todayISO, uid } from '../util.js';
import { alertMaintenances, isRepairLog, maintExpenseId, removeLinkedExpense, segValue, setSeg, syncLinkUI, upsertLinkedExpense } from './vinculo.js';

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

/* ─── Consertos e serviços avulsos ───
   Farol, escapamento, fluido… não têm intervalo de km. Ficam no histórico de uma
   manutenção sem intervalo (as abas Manutencoes/ManutHistorico da planilha já
   guardam isso). Entram no R$/km com manutenção e no "Veículo no mês". */
const REPAIR_LOG_ID = 'consertos';
function repairLog({ create = false } = {}) {
  let m = state.maintenances.find(isRepairLog);
  if (!m && create) {
    m = { id: REPAIR_LOG_ID, name: 'Consertos e serviços', interval: 0, lastOdo: 0, warnKm: 0, cost: 0, history: [] };
    state.maintenances.push(m);
    queueMaint(m);
  }
  return m || null;
}
const repairExpenseDesc = desc => `Conserto · ${desc}`;

// Parcelado (2x ou mais): lança as parcelas no Cartão/Contas como uma compra parcelada comum.
// As parcelas não ficam vinculadas ao conserto (a planilha não recria a despesa a partir dele).
function registerRepair({ desc, date, cost, odo, link, ciclo, parcelas = 1 }) {
  const m = repairLog({ create: true });
  const parcelado = link && cost > 0 && parcelas > 1;
  const linked = link && cost > 0 && !parcelado;
  const h = { id: uid(), date, odo, cost, note: desc, expenseCiclo: linked ? ciclo : '' };
  m.history.unshift(h);
  m.history.sort((a, b) => b.date.localeCompare(a.date));
  queueHist(m.id, h);
  if (linked) upsertLinkedExpense({ id: maintExpenseId(h.id), origem: 'manutencao:' + m.id, date, desc: repairExpenseDesc(desc), value: cost, ciclo });
  if (parcelado) {
    addParcelas({ desc: repairExpenseDesc(desc), cat: 'Transporte', date, competencia: date.slice(0, 7), value: cost, ciclo, fixedId: null, total: parcelas, valueIsTotal: true });
  } else commit();
  return h;
}
function deleteRepair(histId) {
  const m = repairLog();
  if (!m) return;
  m.history = m.history.filter(h => h.id !== histId);
  removeLinkedExpense(maintExpenseId(histId));
  queueHistDelete(m.id, histId);
  commit();
}

function saveRepair() {
  const desc = $('rDesc').value.trim();
  const cost = parseNum($('rCost').value) || 0;
  const odoRaw = parseNum($('rOdo').value);
  const odo = isNaN(odoRaw) ? Math.round(getOdometer()) : odoRaw;
  const date = sanitizeDateStr($('rDate').value) || todayISO();
  const parcelas = parseInt($('rParcN').value, 10) || 1;
  if (!desc) return showToast('⚠️ Informe o que foi feito', { error: true });
  if (parcelas < 1 || parcelas > 72) return showToast('⚠️ Parcelas: de 1 a 72', { error: true });
  const link = $('rLinkExpense').checked;
  registerRepair({ desc, date, cost, odo, link, ciclo: segValue('rLinkCiclo'), parcelas });
  ['rDesc', 'rCost', 'rOdo'].forEach(x => $(x).value = '');
  $('rParcN').value = '1';
  $('rDate').value = todayISO();
  if (!(link && cost > 0 && parcelas > 1)) showToast(link && cost > 0 ? '🛠️ Conserto registrado e lançado como despesa.' : '🛠️ Conserto registrado.');
}
function confirmDeleteRepair(h) {
  const linked = state.expenses.some(e => e.id === maintExpenseId(h.id));
  const extra = linked ? '\nA despesa lançada junto também será excluída.'
    : h.cost ? '\nSe o valor foi lançado parcelado, exclua as parcelas no Cartão/Contas.' : '';
  if (!confirm(`Excluir "${h.note || 'conserto'}" de ${fmtDateBR(h.date)}?${extra}`)) return;
  deleteRepair(h.id);
  showToast('🗑 Conserto excluído.');
}

function renderRepairs() {
  const box = $('repairList');
  box.innerHTML = '';
  if (!$('rDate').value) $('rDate').value = todayISO();
  $('rOdo').placeholder = fmtN(getOdometer(), 0) + ' (atual)';
  const m = repairLog();
  if (!m || !m.history.length) return;
  const card = el('div', { class: 'card' }, el('div', { class: 'card-title' }, '🛠️ Consertos e serviços'));
  m.history.forEach(h => card.append(el('div', { class: 'hist-line' },
    el('div', {}, h.note || 'Conserto', el('div', { style: 'font-size:.7rem' }, `${fmtDateBR(h.date)} · ${fmtN(h.odo, 0)} km`)),
    el('div', { style: 'display:flex;align-items:center;gap:6px;text-align:right' },
      el('div', {}, h.cost ? formatBRL(h.cost) : '', h.expenseCiclo ? el('div', { style: 'font-size:.66rem' }, h.expenseCiclo === 'contas' ? '🧾 Contas' : '💳 Cartão') : null),
      el('button', { class: 'icon-btn', title: 'Excluir', 'aria-label': 'Excluir ' + (h.note || 'conserto'), onclick: () => confirmDeleteRepair(h) }, '🗑️')))));
  card.append(el('div', { class: 'small muted', style: 'margin-top:6px' }, `Total gasto: ${formatBRL(m.history.reduce((a, h) => a + (h.cost || 0), 0))}`));
  box.append(card);
}

function renderMaint() {
  renderRepairs();
  const box = $('maintList');
  box.innerHTML = '';
  const alerts = alertMaintenances();
  if (!alerts.length) { box.append(el('div', { class: 'card empty' }, 'Nenhum alerta cadastrado.')); return; }
  alerts.forEach(m => {
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

export { REPAIR_LOG_ID, askOdometer, cancelOdometer, confirmDeleteRepair, confirmMaintDone, confirmOdometer, deleteMaint, deleteRepair, openMaintDone, pendingOdo, registerRepair, renderMaint, renderRepairs, repairLog, saveMaint, saveRepair };
