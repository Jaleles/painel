import { commit } from '../app.js';
import { state } from '../estado.js';
import { closeModal, openModal } from '../modal.js';
import { queueFuel, queueFuelDelete } from '../sync.js';
import { $, FUEL_COLORS, FUEL_ICONS, FUEL_LABELS, el, esc, fmtDM, fmtDateBR, fmtN, formatBRL, parseNum, sanitizeDateStr, showToast, toInputNum } from '../util.js';
import { autoCalc, resolveFields } from './abastecer.js';
import { TRAJETOS, calcFuels } from './calculos.js';
import { fuelExpenseDesc, fuelExpenseId, removeLinkedExpense, segValue, setSeg, syncLinkUI, upsertLinkedExpense } from './vinculo.js';

/* ─── Histórico de abastecimentos ─── */
const calcMark = (f, k) => f.calcField === k ? '≈ ' : '';
const calcAttr = (f, k) => f.calcField === k ? ' style="color:var(--muted)" title="Calculado só como referência (não está na planilha)"' : '';
function renderFuelHistory() {
  const box = $('fuelHistoryList');
  const fuels = calcFuels().reverse();
  box.innerHTML = '';
  if (!fuels.length) { box.append(el('div', { class: 'card empty' }, 'Nenhum abastecimento registrado ainda.')); return; }
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:10px' });
  fuels.forEach(f => {
    const ft = f.fuelType || 'gas';
    const first = f.consumption === null;
    const card = el('div', { class: 'fuel-card', style: `--fc:${FUEL_COLORS[ft]}` });
    card.innerHTML = `
      <div class="fuel-head">
        <div>
          <div class="fuel-date">📅 ${esc(fmtDateBR(f.date))}</div>
          <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">
            <span class="tag" style="color:${FUEL_COLORS[ft]};background:color-mix(in srgb, ${FUEL_COLORS[ft]} 14%, transparent)">${FUEL_ICONS[ft]} ${esc(FUEL_LABELS[ft])}</span>
            ${f.trajeto ? `<span class="tag">${esc(TRAJETOS[f.trajeto])}</span>` : ''}
            ${f.expenseCiclo ? `<span class="tag ${f.expenseCiclo === 'contas' ? 'contas' : ''}">${f.expenseCiclo === 'contas' ? '🧾 em Contas' : '💳 no Cartão'}</span>` : ''}
          </div>
        </div>
        ${first ? '<span class="kml first">1º abast.</span>' : f.consumption ? `<span class="kml" style="background:${FUEL_COLORS[f.burnedFuel]}">${FUEL_ICONS[f.burnedFuel]} ${fmtN(f.consumption)} km/L</span>` : ''}
      </div>
      <div class="fuel-grid">
        <div><div class="k">Parcial</div><div class="v">${fmtN(f.partial, 0)} km</div></div>
        <div><div class="k">Litros</div><div class="v"${calcAttr(f, 'liters')}>${calcMark(f, 'liters')}${fmtN(f.liters, 2)} L</div></div>
        <div><div class="k">R$/L</div><div class="v"${calcAttr(f, 'pricePerLiter')}>${calcMark(f, 'pricePerLiter')}${esc(formatBRL(f.pricePerLiter))}</div></div>
        <div><div class="k">Total pago</div><div class="v"${calcAttr(f, 'total')}>${calcMark(f, 'total')}${esc(formatBRL(f.total))}</div></div>
        <div><div class="k">Custo/km</div><div class="v">${f.costPerKm ? esc(formatBRL(f.costPerKm)) : '—'}</div></div>
        <div></div>
        ${!first && f.consumption ? `<div class="calc">🧮 ${fmtN(f.partial, 0)} km ÷ ${fmtN(f.prevLiters, 2)} L de ${esc(FUEL_LABELS[f.burnedFuel].toLowerCase())} (abast. de ${fmtDM(f.prevDate)}) = <strong>${fmtN(f.consumption)} km/L</strong> · ${esc(formatBRL(f.prevTotal))} ÷ ${fmtN(f.partial, 0)} km = <strong>${esc(formatBRL(f.costPerKm))}/km</strong></div>` : ''}
        ${f.note ? `<div style="grid-column:1/-1" class="muted small">📝 ${esc(f.note)}</div>` : ''}
      </div>`;
    card.append(el('div', { class: 'card-actions' },
      el('button', { class: 'btn sm ghost', onclick: () => openEditFuel(f.id) }, '✏️ Editar'),
      el('button', { class: 'btn sm danger', onclick: () => deleteFuel(f.id) }, '🗑 Excluir')));
    wrap.append(card);
  });
  box.append(wrap);
}

function openEditFuel(id) {
  const f = state.fuels.find(x => x.id === id);
  if (!f) return;
  $('eId').value = f.id;
  $('eDate').value = f.date;
  $('eFuelType').value = f.fuelType;
  $('eTrajeto').value = f.trajeto || '';
  $('ePartial').value = toInputNum(f.partial);
  $('ePPL').value = f.calcField === 'pricePerLiter' ? '' : toInputNum(f.pricePerLiter);
  $('eLit').value = f.calcField === 'liters' ? '' : toInputNum(f.liters);
  $('eTot').value = f.calcField === 'total' ? '' : toInputNum(f.total);
  $('eNote').value = f.note || '';
  $('eLinkExpense').checked = !!f.expenseCiclo;
  setSeg('eLinkCiclo', f.expenseCiclo || state.fuelCiclo || 'cartao');
  syncLinkUI('eLinkExpense', 'eLinkCiclo');
  ['epPPL', 'epLit', 'epTot'].forEach(x => $(x).textContent = '');
  autoCalc('ePPL', 'eLit', 'eTot', 'epPPL', 'epLit', 'epTot');
  openModal('editFuelModal');
}

function saveEditFuel() {
  const id = $('eId').value;
  const date = sanitizeDateStr($('eDate').value);
  const partial = parseNum($('ePartial').value);
  const resolved = resolveFields($('ePPL').value, $('eLit').value, $('eTot').value);
  if (!date) return showToast('⚠️ Informe a data', { error: true });
  if (isNaN(partial) || partial < 0) return showToast('⚠️ Informe o hodômetro parcial', { error: true });
  if (!resolved) return showToast('⚠️ Preencha ao menos 2 dos 3 campos', { error: true });
  const idx = state.fuels.findIndex(x => x.id === id);
  if (idx < 0) return;
  const old = state.fuels[idx];
  const link = $('eLinkExpense').checked;
  const ciclo = segValue('eLinkCiclo');
  const f = state.fuels[idx] = { ...old, date, partial, fuelType: $('eFuelType').value, trajeto: $('eTrajeto').value, ...resolved, note: $('eNote').value.trim(), expenseCiclo: link ? ciclo : '' };
  if (link) upsertLinkedExpense({ id: fuelExpenseId(f.id), origem: 'abastecimento:' + f.id, date, desc: fuelExpenseDesc(f), value: f.total, ciclo });
  else removeLinkedExpense(fuelExpenseId(f.id));
  queueFuel(f);
  closeModal('editFuelModal');
  commit();
  showToast('✅ Abastecimento atualizado.');
}

function deleteFuel(id) {
  const f = state.fuels.find(x => x.id === id);
  if (!f) return;
  const hasExp = state.expenses.some(e => e.id === fuelExpenseId(id));
  if (!confirm(`Excluir o abastecimento de ${fmtDateBR(f.date)} (${formatBRL(f.total)})?` + (hasExp ? '\n\nA despesa vinculada também será excluída.' : ''))) return;
  state.fuels = state.fuels.filter(x => x.id !== id);
  removeLinkedExpense(fuelExpenseId(id));
  queueFuelDelete(id);
  commit();
  showToast('🗑 Abastecimento removido.');
}

export { calcAttr, calcMark, deleteFuel, openEditFuel, renderFuelHistory, saveEditFuel };
