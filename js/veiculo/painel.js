import { getOdometer, state, ui } from '../estado.js';
import { drawChart } from '../graficos.js';
import { $, FUEL_COLORS, FUEL_ICONS, FUEL_LABELS, compactBRL, el, esc, fmtDM, fmtDateBR, fmtN, formatBRL, monthLabel, monthShort, parseNum, toInputNum } from '../util.js';
import { TRAJETOS, calcFuels, lastPrice, monthlySummary, vehicleStats } from './calculos.js';

/* ─── Painel ─── */
function renderVehiclePanel() {
  const fuels = calcFuels();
  const st = vehicleStats(fuels);
  const desc = [...fuels].reverse();

  $('odoDisplay').innerHTML = `${fmtN(getOdometer(), 0)} <small>km</small>`;
  $('odoPartial').textContent = desc.length ? `${fmtN(desc[0].partial, 0)} km em ${fmtDM(desc[0].date)}` : '—';
  const chips = $('vehChips'); chips.innerHTML = '';
  Object.entries(st.byFuel).forEach(([ft, a]) => { if (a.avg) chips.append(el('span', { class: 'chip' }, `${FUEL_ICONS[ft]} ${fmtN(a.avg)} km/L`)); });
  if (st.cpk) chips.append(el('span', { class: 'chip' }, `💸 ${formatBRL(st.cpk)}/km`));
  const due = state.maintenances.filter(m => m.lastOdo + m.interval - getOdometer() <= m.warnKm).length;
  if (due) chips.append(el('span', { class: 'chip', style: 'color:var(--warning)' }, `🔧 ${due} manutenção(ões) próxima(s)`));

  $('statCpk').textContent = st.cpk ? formatBRL(st.cpk) : '—';
  $('statCpkTotal').textContent = st.cpkTotal ? formatBRL(st.cpkTotal) : '—';
  $('statGasto').textContent = formatBRL(st.totalSpent);
  $('statGastoSub').textContent = st.maintCost ? `+ ${formatBRL(st.maintCost)} manutenção` : 'combustível';
  $('statLitros').textContent = fmtN(st.totalLiters, 1);
  $('statCount').textContent = state.fuels.length;

  renderConsumoTable(st);
  renderFlexCompare(st);
  renderAutonomy(fuels, st);
  renderDashAlerts();
  renderVehicleMonthly(fuels);
}

function renderConsumoTable(st) {
  const box = $('consumoBody');
  const fuelsWith = Object.keys(st.byFuel);
  if (!fuelsWith.length) { box.innerHTML = '<div class="muted small">Registre ao menos dois abastecimentos para calcular o consumo.</div>'; return; }
  let h = '<table class="month-table"><thead><tr><th></th><th>Média</th>' +
    Object.values(TRAJETOS).map(t => `<th>${esc(t)}</th>`).join('') + '</tr></thead><tbody>';
  fuelsWith.forEach(ft => {
    const a = st.byFuel[ft];
    h += `<tr><td><span style="color:${FUEL_COLORS[ft]}">●</span> ${esc(FUEL_LABELS[ft])}<br><span class="muted" style="font-size:.66rem">${a.count} trecho(s)${a.cpk ? ' · ' + esc(formatBRL(a.cpk)) + '/km' : ''}</span></td>
      <td><strong>${a.avg ? fmtN(a.avg) : '—'}</strong></td>` +
      Object.keys(TRAJETOS).map(tj => { const t = a.byTrajeto[tj]; return `<td>${t && t.avg ? fmtN(t.avg) + `<br><span class="muted" style="font-size:.64rem">${t.count}×</span>` : '—'}</td>`; }).join('') +
      '</tr>';
  });
  h += '</tbody></table>';
  h += '<div class="hint" style="margin-top:8px">km/L de cada trecho = km rodados ÷ litros do abastecimento anterior, contado para o combustível que estava no tanque. Trechos sem trajeto informado entram só na média geral do combustível.</div>';
  box.innerHTML = h;
}

function renderFlexCompare(st) {
  const box = $('flexBody');
  const g = st.byFuel.gas, e = st.byFuel.eth;
  if (!$('flexGas').value && lastPrice('gas')) $('flexGas').value = toInputNum(lastPrice('gas'));
  if (!$('flexEth').value && lastPrice('eth')) $('flexEth').value = toInputNum(lastPrice('eth'));
  const pg = parseNum($('flexGas').value), pe = parseNum($('flexEth').value);
  const ratio = g && e && g.avg && e.avg ? e.avg / g.avg : null;
  const usedRatio = ratio || 0.7;
  const note = ratio ? `Seu etanol rende ${fmtN(ratio * 100, 0)}% da gasolina (${fmtN(e.avg)} ÷ ${fmtN(g.avg)} km/L).`
    : 'Ainda sem dados dos dois combustíveis — usando a regra geral de 70%.';
  if (!(pg > 0) || !(pe > 0)) { box.innerHTML = `<div class="hint">${esc(note)} Informe os preços para comparar.</div>`; return; }
  const limit = pg * usedRatio;
  const ethBetter = pe < limit;
  const gasKm = g && g.avg ? pg / g.avg : null, ethKm = e && e.avg ? pe / e.avg : null;
  box.innerHTML = `
    <div style="font-size:1.25rem;font-weight:800;margin-bottom:4px;color:${ethBetter ? FUEL_COLORS.eth : FUEL_COLORS.gas}">${ethBetter ? '🌿 Etanol compensa' : '⛽ Gasolina compensa'}</div>
    <div class="small">Etanol vale a pena até <strong>${esc(formatBRL(limit))}</strong>/L com a gasolina a ${esc(formatBRL(pg))}.</div>
    ${gasKm && ethKm ? `<div class="small muted" style="margin-top:4px">Custo por km: gasolina ${esc(formatBRL(gasKm))} · etanol ${esc(formatBRL(ethKm))}</div>` : ''}
    <div class="hint" style="margin-top:6px">${esc(note)}</div>`;
}

function renderAutonomy(fuels, st) {
  const body = $('autonomyBody');
  const inputBox = $('autonomyInput');
  const last = fuels[fuels.length - 1];
  const agg = last ? st.byFuel[last.fuelType] : null;
  const kml = agg ? (agg.recentAvg || agg.avg) : null;
  if (!last || !last.liters) {
    body.className = 'muted small';
    body.textContent = 'Registre abastecimentos para estimar a autonomia.';
    inputBox.classList.add('hidden');
    return;
  }
  if (!kml) {
    body.className = 'muted small';
    body.textContent = `Ainda não há consumo medido com ${FUEL_LABELS[last.fuelType].toLowerCase()} — a estimativa aparece depois do próximo abastecimento.`;
    inputBox.classList.add('hidden');
    return;
  }
  inputBox.classList.remove('hidden');
  const range = last.liters * kml;
  const trip = parseNum(ui.currentTrip);
  const fuelTxt = `${fmtN(last.liters, 1)} L de ${FUEL_LABELS[last.fuelType].toLowerCase()} (${fmtDM(last.date)}) a ${fmtN(kml)} km/L`;
  body.className = '';
  body.innerHTML = '';
  if (!isNaN(trip) && trip >= 0) {
    const remaining = Math.max(0, range - trip);
    const pct = Math.max(0, Math.min(100, (remaining / range) * 100));
    body.append(
      el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:8px' },
        el('div', { style: 'font-size:1.9rem;font-weight:800;letter-spacing:-.02em' }, `~${fmtN(remaining, 0)} km`),
        el('div', { class: 'muted small' }, `≈ ${fmtN(remaining / kml, 1)} L até a reserva`)),
      el('div', { class: 'autonomy-bar' }, el('i', { style: `width:${pct.toFixed(0)}%` })),
      el('div', { class: 'hint' }, `Rodou ${fmtN(trip, 0)} de ~${fmtN(range, 0)} km com ${fuelTxt}.` + (pct < 15 ? ' ⚠️ A reserva deve acender em breve.' : '')));
  } else {
    body.append(
      el('div', { style: 'font-size:1.9rem;font-weight:800;letter-spacing:-.02em' }, `~${fmtN(range, 0)} km`),
      el('div', { class: 'hint', style: 'margin-top:4px' }, `Até a próxima reserva, com ${fuelTxt} (média dos últimos trechos desse combustível). Informe a parcial atual para ver quanto resta.`));
  }
}

function renderVehicleMonthly(fuels) {
  const months = monthlySummary(fuels);
  const table = $('monthTable');
  if (!months.length) { table.innerHTML = ''; return; }
  table.innerHTML = '<thead><tr><th>Mês</th><th>Gasto</th><th>Litros</th><th>Km</th><th>R$/km</th></tr></thead><tbody>' +
    [...months].reverse().map(m => `<tr>
      <td>${esc(monthShort(m.ym))}</td>
      <td>${esc(formatBRL(m.spent))}${m.maint ? '<br><span class="muted" style="font-size:.66rem">+' + esc(formatBRL(m.maint)) + ' manut.</span>' : ''}</td>
      <td>${fmtN(m.liters, 1)}</td>
      <td>${fmtN(m.km, 0)}</td>
      <td>${m.cpk ? esc(formatBRL(m.cpk)) : '—'}</td></tr>`).join('') + '</tbody>';
}

function renderVehicleCharts() {
  const fuels = calcFuels();
  const trechos = fuels.filter(f => f.consumption !== null).slice(-24);
  const types = ['gas', 'eth', 'die'].filter(ft => trechos.some(f => f.burnedFuel === ft));
  drawChart($('chartKml'), {
    labels: trechos.map(f => fmtDM(f.date)),
    tipLabels: trechos.map(f => `${fmtDateBR(f.date)}${f.trajeto ? ' · ' + TRAJETOS[f.trajeto] : ''}`),
    series: types.map(ft => ({ name: FUEL_LABELS[ft], values: trechos.map(f => f.burnedFuel === ft ? f.consumption : null), color: FUEL_COLORS[ft], connectNulls: true, dots: true })),
    fmt: v => fmtN(v) + ' km/L', axisFmt: v => fmtN(v, 0), tightMin: true
  });
  const months = monthlySummary(fuels);
  drawChart($('chartVehMonthly'), {
    type: 'bar', labels: months.map(m => monthShort(m.ym)), tipLabels: months.map(m => monthLabel(m.ym)),
    series: [{ name: 'Combustível', values: months.map(m => m.spent), color: 'var(--c-veiculo)' }],
    fmt: formatBRL, axisFmt: compactBRL
  });
}

function renderDashAlerts() {
  const box = $('dashAlerts');
  const pend = state.maintenances.filter(m => m.lastOdo + m.interval - getOdometer() <= m.warnKm);
  box.innerHTML = '';
  if (!pend.length) return;
  const card = el('div', { class: 'card' }, el('div', { class: 'card-title' }, '⚠️ Manutenções próximas'));
  const list = el('div', { class: 'list' });
  pend.forEach(m => {
    const rem = m.lastOdo + m.interval - getOdometer();
    list.append(el('div', { class: 'item' },
      el('span', { class: 'item-title' }, m.name),
      el('span', { class: 'tag ' + (rem <= 0 ? 'danger' : 'warn') }, rem <= 0 ? 'VENCIDA' : `faltam ${fmtN(rem, 0)} km`)));
  });
  card.append(list);
  box.append(card);
}

export { renderAutonomy, renderConsumoTable, renderDashAlerts, renderFlexCompare, renderVehicleCharts, renderVehicleMonthly, renderVehiclePanel };
