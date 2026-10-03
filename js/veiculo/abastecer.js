import { commit } from '../app.js';
import { saveUI, state, ui } from '../estado.js';
import { queueFuel } from '../sync.js';
import { $, FUEL_LABELS, fmtDM, fmtN, formatBRL, parseNum, round2, sanitizeDateStr, showToast, todayISO, uid, vibrate } from '../util.js';
import { calcFuels, vehicleStats } from './calculos.js';
import { switchVehSub } from './tela.js';
import { fuelExpenseDesc, fuelExpenseId, segValue, setSeg, sortFuelsAsc, syncLinkUI, upsertLinkedExpense } from './vinculo.js';

/* ─── Abastecer ─── */
function selectFuel(type) {
  $('fuelPills').querySelectorAll('.pill').forEach(p => p.classList.toggle('on', p.dataset.fuel === type));
}
const selectedFuel = () => ($('fuelPills').querySelector('.pill.on') || {}).dataset?.fuel || 'gas';

function autoCalc(pplId, litId, totId, pvPPL, pvLit, pvTot) {
  const ppl = parseNum($(pplId).value), lit = parseNum($(litId).value), tot = parseNum($(totId).value);
  [pvPPL, pvLit, pvTot].forEach(id => $(id).textContent = '');
  const ok = [ppl > 0, lit > 0, tot > 0];
  if (ok.filter(Boolean).length < 2) return;
  if (ok[0] && ok[1] && !ok[2]) $(pvTot).textContent = '→ ' + formatBRL(ppl * lit);
  else if (ok[0] && ok[2] && !ok[1]) $(pvLit).textContent = '→ ' + fmtN(tot / ppl, 2) + ' L';
  else if (ok[1] && ok[2] && !ok[0]) $(pvPPL).textContent = '→ ' + formatBRL(tot / lit) + '/L';
}
function resolveFields(ppl, lit, tot) {
  let p = parseNum(ppl) || 0, l = parseNum(lit) || 0, t = parseNum(tot) || 0;
  if ([p > 0, l > 0, t > 0].filter(Boolean).length < 2) return null;
  // O campo que faltar é calculado só como referência (calcField): usado nas contas do app,
  // mas não é gravado na planilha — lá ficam apenas os valores reais do cupom.
  let calcField = '';
  if (p > 0 && l > 0 && !t) { t = p * l; calcField = 'total'; }
  if (p > 0 && t > 0 && !l) { l = t / p; calcField = 'liters'; }
  if (l > 0 && t > 0 && !p) { p = t / l; calcField = 'pricePerLiter'; }
  return { pricePerLiter: Math.round(p * 1000) / 1000, liters: Math.round(l * 1000) / 1000, total: round2(t), calcField };
}
function selectTrajeto(tj) {
  $('trajetoPills').querySelectorAll('.pill').forEach(p => p.classList.toggle('on', p.dataset.trajeto === tj));
}
const selectedTrajeto = () => ($('trajetoPills').querySelector('.pill.on') || {}).dataset?.trajeto || '';

function previewConsumption() {
  const partial = parseNum($('fPartial').value);
  const out = $('prevConsumption');
  if (isNaN(partial) || partial <= 0) { out.textContent = ''; return; }
  const sorted = sortFuelsAsc(state.fuels);
  if (!sorted.length) { out.textContent = '→ Primeiro abastecimento — o consumo aparece no próximo.'; return; }
  const last = sorted[sorted.length - 1];
  if (last.liters > 0) {
    const kml = partial / last.liters;
    const ref = vehicleStats(calcFuels()).byFuel[last.fuelType];
    let cmp = '';
    if (ref && ref.avg) {
      const d = (kml / ref.avg - 1) * 100;
      cmp = Math.abs(d) < 3 ? ' · na média' : ` · ${d > 0 ? '▲' : '▼'} ${fmtN(Math.abs(d), 0)}% vs média`;
    }
    out.textContent = `→ ${fmtN(kml)} km/L de ${FUEL_LABELS[last.fuelType].toLowerCase()}${cmp} · ${formatBRL(last.total / partial)}/km (${fmtN(partial, 0)} km ÷ ${fmtN(last.liters, 2)} L de ${fmtDM(last.date)})`;
  }
}

function resetFuelForm() {
  ['fPartial', 'fPPL', 'fLit', 'fTot', 'fNote'].forEach(id => $(id).value = '');
  ['pvPPL', 'pvLit', 'pvTot', 'prevConsumption'].forEach(id => $(id).textContent = '');
  $('fDate').value = todayISO();
  const last = sortFuelsAsc(state.fuels).pop();
  selectFuel(last ? last.fuelType : 'gas');
  selectTrajeto(ui.lastTrajeto || 'misto');
  $('fLinkExpense').checked = !!state.fuelLinkDefault;
  setSeg('fLinkCiclo', state.fuelCiclo || 'cartao');
  syncLinkUI('fLinkExpense', 'fLinkCiclo');
}

function saveFuel() {
  const date = sanitizeDateStr($('fDate').value);
  const partial = parseNum($('fPartial').value);
  const resolved = resolveFields($('fPPL').value, $('fLit').value, $('fTot').value);
  const note = $('fNote').value.trim();
  if (!date) return showToast('⚠️ Informe a data', { error: true });
  if (isNaN(partial) || partial < 0) return showToast('⚠️ Informe o hodômetro parcial', { error: true });
  if (!resolved) return showToast('⚠️ Preencha ao menos 2 dos 3 campos', { error: true });

  const link = $('fLinkExpense').checked;
  const ciclo = segValue('fLinkCiclo');
  const trajeto = selectedTrajeto();
  const ord = state.fuels.reduce((m, f) => Math.max(m, f.ord || 0), 0) + 1;
  const fuel = { id: uid(), ord, date, partial, fuelType: selectedFuel(), trajeto, ...resolved, note, expenseCiclo: link ? ciclo : '' };
  state.fuels.push(fuel);
  queueFuel(fuel);
  if (link) upsertLinkedExpense({ id: fuelExpenseId(fuel.id), origem: 'abastecimento:' + fuel.id, date, desc: fuelExpenseDesc(fuel), value: fuel.total, ciclo });

  ui.currentTrip = ''; if (trajeto) ui.lastTrajeto = trajeto; saveUI();
  resetFuelForm();
  commit();
  vibrate([20, 40, 20]);
  showToast(link ? `⛽ Salvo e lançado no ${ciclo === 'contas' ? 'Contas' : 'Cartão'}.` : '⛽ Abastecimento salvo.');
  switchVehSub('historico');
}

export { autoCalc, previewConsumption, resetFuelForm, resolveFields, saveFuel, selectFuel, selectTrajeto, selectedFuel, selectedTrajeto };
