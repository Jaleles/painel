import { commit } from '../app.js';
import { state } from '../estado.js';
import { parcelaInfo } from './comum.js';
import { closeModal, openModal } from '../modal.js';
import { deleteExpenseRemote } from '../sync.js';
import { $, formatBRL, showToast } from '../util.js';
import { unlinkVehicleFromExpense } from '../veiculo/vinculo.js';

/* ─── Exclusão compartilhada ─── */
let pendingParcelDelete = null;
function confirmDeleteExpense(id) {
  const it = state.expenses.find(e => e.id === String(id));
  if (!it) return;
  const pi = parcelaInfo(it);
  if (pi) {
    const later = state.expenses.filter(e => { const p = parcelaInfo(e); return p && p.group === pi.group && p.n > pi.n; });
    if (later.length) {
      pendingParcelDelete = { it, later };
      $('parcelDeleteText').textContent = `"${it.desc}" (${formatBRL(it.value)}) faz parte de um parcelamento. Ainda há ${later.length} parcela(s) depois desta.`;
      $('btnDelParcelAll').textContent = `Esta e as ${later.length} seguintes`;
      openModal('parcelDeleteModal');
      return;
    }
  }
  const linked = it.origem && !pi ? '\n\nEla está vinculada a um registro do veículo; o registro continua lá, só perde o vínculo.' : '';
  if (!confirm(`Excluir "${it.desc}" (${formatBRL(it.value)})?${linked}`)) return;
  deleteExpenses([it]);
}
function resolveParcelDelete(all) {
  if (!pendingParcelDelete) return;
  const { it, later } = pendingParcelDelete;
  pendingParcelDelete = null;
  closeModal('parcelDeleteModal');
  deleteExpenses(all ? [it, ...later] : [it]);
}
function deleteExpenses(list) {
  const ids = new Set(list.map(e => e.id));
  const backup = list.map(e => ({ ...e }));
  state.expenses = state.expenses.filter(e => !ids.has(e.id));
  commit();
  let undone = false;
  showToast(list.length > 1 ? `${list.length} despesas excluídas.` : 'Despesa excluída.', {
    actionLabel: 'Desfazer', duration: 5000,
    onAction: () => { undone = true; state.expenses.push(...backup); commit(); }
  });
  setTimeout(() => {
    if (undone) return;
    backup.forEach(b => { unlinkVehicleFromExpense(b); deleteExpenseRemote(b.id); });
  }, 5200);
}

export { confirmDeleteExpense, deleteExpenses, pendingParcelDelete, resolveParcelDelete };
