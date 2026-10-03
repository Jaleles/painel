import { state } from '../estado.js';
import { deleteExpenseRemote, queueFuel, queueHist, syncExpense } from '../sync.js';
import { $, FUEL_LABELS, fmtN, round2 } from '../util.js';

/* ════════════════════════════════════════════════════════════
   VEÍCULO — abastecimentos, painel, histórico, manutenção
   Regra do km/L (mantida do FuelTrack): consumo[N] = parcial[N] ÷ litros[N−1]
   Custo por km (mesma lógica):        R$/km[N]  = total[N−1]  ÷ parcial[N]
════════════════════════════════════════════════════════════ */
const fuelExpenseId = fuelId => 'ab_' + fuelId;
const maintExpenseId = histId => 'mn_' + histId;
const sortFuelsAsc = list => [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.ord || 1e9) - (b.ord || 1e9) || a.id.localeCompare(b.id));
// Consertos avulsos ficam como histórico de uma "manutenção" sem intervalo de km: não gera alerta
const isRepairLog = m => !(m.interval > 0);
const alertMaintenances = () => state.maintenances.filter(m => !isRepairLog(m));

function segValue(containerId) {
  const b = $(containerId).querySelector('button.active');
  return b ? b.dataset.ciclo : 'cartao';
}
function setSeg(containerId, value) {
  $(containerId).querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.ciclo === value));
}
function syncLinkUI(checkId, segId) {
  $(segId).classList.toggle('hidden', !$(checkId).checked);
}

/* ─── Vínculo com despesas ─── */
function upsertLinkedExpense({ id, origem, date, desc, value, ciclo }) {
  const idx = state.expenses.findIndex(e => e.id === id);
  const prev = idx >= 0 ? state.expenses[idx] : null;
  const exp = {
    ...(prev || {}),
    id, origem, date, desc, value: round2(value), ciclo,
    cat: prev ? prev.cat : 'Transporte',
    competencia: (prev && prev.date.slice(0, 7) !== prev.competencia) ? prev.competencia : date.slice(0, 7),
    fixedId: null, synced: false
  };
  if (prev && prev.ciclo !== ciclo) exp.competencia = date.slice(0, 7);
  if (idx >= 0) state.expenses[idx] = exp; else state.expenses.push(exp);
  syncExpense(prev ? 'updateExpense' : 'addExpense', exp, { silent: true });
}
function removeLinkedExpense(id) {
  if (!state.expenses.some(e => e.id === id)) return;
  state.expenses = state.expenses.filter(e => e.id !== id);
  deleteExpenseRemote(id);
}
function fuelExpenseDesc(f) {
  return `Combustível · ${FUEL_LABELS[f.fuelType] || 'Gasolina'} ${fmtN(f.liters, 1)} L`;
}
// Quando a despesa é excluída direto no Gastos, o registro do veículo perde o vínculo
function unlinkVehicleFromExpense(exp) {
  if (!exp.origem) return;
  const [kind, ref] = exp.origem.split(':');
  if (kind === 'abastecimento') {
    const f = state.fuels.find(x => x.id === ref);
    if (f && f.expenseCiclo) { f.expenseCiclo = ''; queueFuel(f); }
  } else if (kind === 'manutencao') {
    state.maintenances.forEach(m => m.history.forEach(h => {
      if (maintExpenseId(h.id) === exp.id && h.expenseCiclo) { h.expenseCiclo = ''; queueHist(m.id, h); }
    }));
  }
}

export { alertMaintenances, fuelExpenseDesc, fuelExpenseId, isRepairLog, maintExpenseId, removeLinkedExpense, segValue, setSeg, sortFuelsAsc, syncLinkUI, unlinkVehicleFromExpense, upsertLinkedExpense };
