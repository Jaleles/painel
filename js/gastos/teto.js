import { state } from '../estado.js';
import { cartaoCycleExpenses } from './cartao.js';
import { currentMonth, sumValues } from './comum.js';
import { billsProjection } from './contas.js';
import { $, fmtN, formatBRL, monthLabel } from '../util.js';

/* ════════════ TETO TOTAL ════════════ */
function renderTeto() {
  const cardLimit = Number(state.monthlyLimit || 0);
  const cardSpent = sumValues(cartaoCycleExpenses()) + Number(state.initialSpent || 0);
  const comp = currentMonth();
  const proj = billsProjection(comp);

  const totalUsed = cardSpent + proj.spent;
  const totalLimit = Number(state.totalLimit || 0);
  const totalEstimate = cardSpent + proj.total;

  $('totalLimitUsed').textContent = formatBRL(totalUsed);
  $('totalLimitInfo').textContent = totalLimit > 0 ? `de ${formatBRL(totalLimit)} · projeção: ${formatBRL(totalEstimate)}` : 'Defina o Teto Total em Ajustes ⚙️';
  const pct = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;
  const bar = $('totalProgressBar');
  bar.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
  bar.style.background = pct > 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--c-teto)';

  $('homeCardSpent').textContent = formatBRL(cardSpent);
  $('homeCardSub').textContent = cardLimit > 0 ? `Teto: ${formatBRL(cardLimit)}` : 'Teto não definido';
  $('homeBillsSpent').textContent = formatBRL(proj.spent);
  $('homeBillsSub').textContent = proj.pendingCount ? `Previsto: ${formatBRL(proj.total)} (${proj.pendingCount} fixa(s) a lançar)` : `${monthLabel(comp)} · fixas em dia`;

  let summary;
  if (totalLimit > 0) {
    const rest = totalLimit - totalEstimate;
    summary = rest >= 0 ? `Pela projeção, devem sobrar ${formatBRL(rest)} do Teto Total neste mês.`
      : `⚠️ A projeção indica estouro do Teto Total em ${formatBRL(Math.abs(rest))}.`;
    summary += ` Contas previstas: fixas ${formatBRL(proj.fixasLaunched + proj.pendingEstimate)} + avulsos/parcelas ${formatBRL(proj.avulsos)}.`;
  } else summary = 'Defina o Teto Total em Ajustes para ver a projeção do mês completo.';
  $('homeSummaryText').textContent = summary;

  // Veículo no mês corrente (informativo)
  const ym = currentMonth();
  const fuelsMonth = state.fuels.filter(f => f.date.startsWith(ym));
  const maintMonth = state.maintenances.flatMap(m => m.history).filter(h => h.date.startsWith(ym));
  $('homeVehicleMonth').textContent = monthLabel(ym);
  $('homeVehFuel').textContent = formatBRL(fuelsMonth.reduce((a, f) => a + f.total, 0));
  $('homeVehMaint').textContent = formatBRL(maintMonth.reduce((a, h) => a + h.cost, 0));
  $('homeVehKm').textContent = fmtN(fuelsMonth.reduce((a, f) => a + f.partial, 0), 0);
}

export { renderTeto };
