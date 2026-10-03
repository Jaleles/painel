import { commit } from '../app.js';
import { state } from '../estado.js';
import { addMonths, currentMonth, expenseCompetencia, matchesCardInvoice, populateCategories } from './comum.js';
import { deleteFixedRemote, saveFixedRemote } from '../sync.js';
import { $, el, formatBRL, monthLabel, monthShort, parseMoneyInput, showToast, toInputNum } from '../util.js';

/* ════════════ FIXAS ════════════ */
let editingFixedId = null;
function fixaRow(f, archived) {
  const info = `Ref. ${formatBRL(f.refValue)}${f.dueDay ? ' · vence dia ' + f.dueDay : ''}` +
    (f.inicio ? ` · desde ${monthShort(f.inicio)}` : '') + (f.fim ? ` · até ${monthShort(f.fim)}` : '');
  return el('div', { class: 'item', style: archived ? 'opacity:.65' : '' },
    el('div', { class: 'item-info' },
      el('span', { class: 'item-title' }, f.desc),
      el('div', { class: 'item-sub' }, info, matchesCardInvoice(f.desc) ? el('span', { class: 'tag danger' }, '⚠️ fatura do cartão principal') : null)),
    el('div', { class: 'item-right' },
      el('button', { class: 'icon-btn', title: 'Editar', 'aria-label': 'Editar fixa ' + f.desc, onclick: () => startEditFixed(f.id) }, '✏️'),
      archived
        ? el('button', { class: 'icon-btn', title: 'Reativar', 'aria-label': 'Reativar fixa ' + f.desc, onclick: () => setFixaFim(f.id, '') }, '♻️')
        : el('button', { class: 'icon-btn', title: 'Encerrar (arquivar)', 'aria-label': 'Arquivar fixa ' + f.desc, onclick: () => archiveFixed(f.id) }, '📦'),
      el('button', { class: 'icon-btn', title: 'Excluir', 'aria-label': 'Excluir fixa ' + f.desc, onclick: () => deleteFixed(f.id) }, '🗑️')));
}
function renderFixedManageList() {
  const box = $('fixedManageList');
  box.innerHTML = '';
  if (!state.fixedItems.length) { box.append(el('div', { class: 'empty', style: 'padding:8px' }, 'Nenhuma fixa cadastrada ainda.')); return; }
  const cur = currentMonth();
  const active = state.fixedItems.filter(f => !f.fim || f.fim >= cur);
  const archived = state.fixedItems.filter(f => f.fim && f.fim < cur);
  active.forEach(f => box.append(fixaRow(f, false)));
  if (archived.length) {
    box.append(el('div', { class: 'section-label', style: 'margin-top:8px' }, `Encerradas (${archived.length})`));
    archived.forEach(f => box.append(fixaRow(f, true)));
  }
}
function lastLaunchComp(f) {
  return state.expenses.filter(e => e.ciclo === 'contas' && String(e.fixedId) === String(f.id))
    .map(expenseCompetencia).sort().pop() || null;
}
function archiveFixed(id) {
  const f = state.fixedItems.find(x => x.id === String(id));
  if (!f) return;
  const fim = lastLaunchComp(f) || addMonths(currentMonth(), -1);
  if (!confirm(`Encerrar "${f.desc}"? A última competência será ${monthLabel(fim)}.\n\nO histórico continua, e ela deixa de aparecer como pendente nos meses seguintes. Dá para reativar depois.`)) return;
  setFixaFim(id, fim);
}
function setFixaFim(id, fim) {
  const f = state.fixedItems.find(x => x.id === String(id));
  if (!f) return;
  f.fim = fim;
  saveFixedRemote(f);
  commit();
  populateCategories();
  showToast(fim ? `"${f.desc}" encerrada em ${monthShort(fim)}.` : `"${f.desc}" reativada.`);
}
function startEditFixed(id) {
  const f = state.fixedItems.find(x => x.id === String(id));
  if (!f) return;
  editingFixedId = f.id;
  $('fixedDesc').value = f.desc;
  $('fixedRefValue').value = toInputNum(f.refValue);
  $('fixedDueDay').value = f.dueDay || '';
  $('fixedInicio').value = f.inicio || '';
  $('btnCancelFixed').classList.remove('hidden');
  $('fixedDesc').focus();
}
function cancelEditFixed() {
  editingFixedId = null;
  $('fixedForm').reset();
  $('fixedInicio').value = currentMonth();
  $('btnCancelFixed').classList.add('hidden');
}
function deleteFixed(id) {
  const f = state.fixedItems.find(x => x.id === String(id));
  if (!f) return;
  if (!confirm(`Excluir o cadastro de "${f.desc}"? Os lançamentos já feitos não são apagados.\n\nSe a conta só acabou, prefira "Encerrar" (📦), que mantém o histórico organizado.`)) return;
  state.fixedItems = state.fixedItems.filter(x => x.id !== f.id);
  commit();
  deleteFixedRemote(f.id);
  showToast('Despesa fixa removida.');
}
function onSubmitFixed(ev) {
  ev.preventDefault();
  const desc = $('fixedDesc').value.trim();
  const refValue = parseMoneyInput($('fixedRefValue').value) || 0;
  const dueDay = parseInt($('fixedDueDay').value, 10) || null;
  const inicio = $('fixedInicio').value || currentMonth();
  if (!desc) return showToast('Informe o nome da fixa.', { error: true });
  if (matchesCardInvoice(desc) && !confirm(`"${desc}" parece ser a fatura do cartão principal. Os gastos desse cartão já entram no ciclo Cartão — cadastrar como fixa conta em dobro no Teto Total.\n\nCadastrar mesmo assim?`)) return;
  let fx;
  if (editingFixedId) {
    const idx = state.fixedItems.findIndex(f => f.id === editingFixedId);
    if (idx >= 0) fx = state.fixedItems[idx] = { ...state.fixedItems[idx], desc, cat: desc, refValue, dueDay, inicio };
    showToast('Fixa atualizada.');
  } else {
    fx = { id: String(Date.now()), desc, cat: desc, refValue, dueDay, inicio, fim: '' }; // Opção A: nome da fixa = categoria
    state.fixedItems.push(fx);
    showToast('Fixa cadastrada.');
  }
  if (fx) saveFixedRemote(fx);
  cancelEditFixed();
  commit();
  populateCategories();
}

// Fixas antigas não tinham "início": usa a 1ª competência em que foram lançadas
// (evita que apareçam como pendentes em meses anteriores ao cadastro).
function ensureFixasInicio({ push = false } = {}) {
  state.fixedItems.forEach(f => {
    if (f.inicio) return;
    const first = state.expenses.filter(e => e.ciclo === 'contas' && String(e.fixedId) === String(f.id)).map(expenseCompetencia).sort()[0];
    f.inicio = first || currentMonth();
    if (push) saveFixedRemote(f);
  });
}

export { archiveFixed, cancelEditFixed, deleteFixed, editingFixedId, ensureFixasInicio, fixaRow, lastLaunchComp, onSubmitFixed, renderFixedManageList, setFixaFim, startEditFixed };
