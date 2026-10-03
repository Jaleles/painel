import { state } from '../estado.js';
import { fillList, sumValues } from './comum.js';
import { $, fmtDateBR, formatBRL, sanitizeDateStr } from '../util.js';

/* ════════════ HISTÓRICO ════════════ */
function renderHistory() {
  const hStart = sanitizeDateStr($('histStartDate').value);
  const hEnd = sanitizeDateStr($('histEndDate').value);
  const term = $('histSearchText').value.trim().toLowerCase();
  const cat = $('histCatFilter').value;
  const ciclo = $('histCicloFilter').value;
  if (!hStart || !hEnd) return;
  const filtered = state.expenses.filter(e =>
    e.date >= hStart && e.date <= hEnd &&
    (!cat || e.cat === cat) && (!ciclo || e.ciclo === ciclo) &&
    (!term || e.desc.toLowerCase().includes(term)));
  $('histTotalValue').textContent = formatBRL(sumValues(filtered));
  $('histSummaryInfo').textContent = `${filtered.length} lançamento(s) entre ${fmtDateBR(hStart)} e ${fmtDateBR(hEnd)}`;
  fillList($('historyExpenseList'), filtered, `Nada encontrado para o filtro. (Total na base: ${state.expenses.length})`, { showCiclo: true });
}

export { renderHistory };
