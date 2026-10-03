import { getOdometer, saveUI, state, ui } from '../estado.js';
import { $, fmtN } from '../util.js';
import { renderFuelHistory } from './historico.js';
import { renderMaint } from './manutencao.js';
import { renderVehicleCharts, renderVehiclePanel } from './painel.js';
import { sortFuelsAsc } from './vinculo.js';

function renderVehicle() {
  const last = sortFuelsAsc(state.fuels).pop();
  $('fuelOdoInfo').textContent = `hodôm. ${fmtN(getOdometer(), 0)} km`;
  if (ui.vehSub === 'painel') renderVehiclePanel();
  if (ui.vehSub === 'historico') renderFuelHistory();
  if (ui.vehSub === 'manutencao') renderMaint();
  return last;
}

function switchVehSub(sub) {
  ui.vehSub = sub; saveUI();
  $('vehTabs').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
  document.querySelectorAll('#view-veiculo .sub').forEach(s => s.classList.toggle('hidden', s.dataset.sub !== sub));
  renderVehicle();
  if (sub === 'painel') renderVehicleCharts();
  window.scrollTo({ top: 0 });
}

export { renderVehicle, switchVehSub };
