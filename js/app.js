import { applyImportedVehicle, disconnect, exportJson, fillConfigForm, importJsonFile, importLegacyUrl, nextCycle, renderBackups, renderConnState, renderLegacyInfo, saveConfig, saveConnection } from './ajustes.js';
import { isConnected, loadLocal, persist, saveUI, state, ui } from './estado.js';
import { cancelEdit, editingId, onSubmitExpense, renderCartao, renderCartaoChart } from './gastos/cartao.js';
import { currentMonth, populateCategories } from './gastos/comum.js';
import { autoBillsCompetencia, cancelEditBill, currentBillsCompetencia, editingBillId, onSubmitBill, renderContas, renderContasChart, resetBillsCompetencia, shiftBillsCompetencia } from './gastos/contas.js';
import { resolveParcelDelete } from './gastos/exclusao.js';
import { cancelEditFixed, ensureFixasInicio, onSubmitFixed, renderFixedManageList } from './gastos/fixas.js';
import { renderHistory } from './gastos/historico.js';
import { renderTeto } from './gastos/teto.js';
import { closeModal } from './modal.js';
import { finishSyncStatus, pullAll, pulling, queueVehicleFull, refreshSyncBadge, scheduleFlush } from './sync.js';
import { $, LEGACY_FUEL_KEY, sanitizeDateStr, showToast, store, todayISO } from './util.js';
import { autoCalc, previewConsumption, resetFuelForm, saveFuel, selectFuel, selectTrajeto } from './veiculo/abastecer.js';
import { calcFuels, vehicleStats } from './veiculo/calculos.js';
import { saveEditFuel } from './veiculo/historico.js';
import { askOdometer, confirmMaintDone, confirmOdometer, saveMaint } from './veiculo/manutencao.js';
import { renderAutonomy, renderFlexCompare, renderVehicleCharts } from './veiculo/painel.js';
import { renderVehicle, switchVehSub } from './veiculo/tela.js';
import { setSeg, syncLinkUI } from './veiculo/vinculo.js';

/* ════════════════════════════════════════════════════════════
   APP — navegação, tema, ajustes, importação, inicialização
════════════════════════════════════════════════════════════ */
const VIEWS = {
  cartao: { accent: '--c-cartao', logo: '💳' },
  contas: { accent: '--c-contas', logo: '🧾' },
  teto: { accent: '--c-teto', logo: '🎯' },
  veiculo: { accent: '--c-veiculo', logo: '🚗' },
  historico: { accent: '--c-hist', logo: '📜' },
  ajustes: { accent: '--c-teto', logo: '⚙️' }
};
let lastMainView = 'cartao';

function switchView(view) {
  if (!VIEWS[view]) view = 'cartao';
  if (view !== 'ajustes') lastMainView = view;
  ui.view = view; saveUI();
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('btnSettings').classList.toggle('active', view === 'ajustes');
  document.documentElement.style.setProperty('--accent', `var(${VIEWS[view].accent})`);
  $('brandLogo').textContent = VIEWS[view].logo;
  renderView(view);
  window.scrollTo({ top: 0 });
}

function renderView(view) {
  switch (view) {
    case 'cartao': renderCartao(); renderCartaoChart(); break;
    case 'contas': renderContas(); renderContasChart(); break;
    case 'teto': renderTeto(); break;
    case 'veiculo': renderVehicle(); if (ui.vehSub === 'painel') renderVehicleCharts(); break;
    case 'historico': renderHistory(); break;
    case 'ajustes': fillConfigForm(); renderFixedManageList(); renderBackups(); renderLegacyInfo(); break;
  }
  refreshSyncBadge();
}

// Salva e redesenha a tela atual
function commit() { persist(); renderView(ui.view); }
// Após sincronizar: atualiza tudo que depende dos dados
function afterDataChange() {
  populateCategories();
  if (!editingBillId) $('billCompetencia').value = currentBillsCompetencia || autoBillsCompetencia();
  renderView(ui.view);
}
// Só listas (ex.: remover tag "pendente" após confirmação do servidor), sem refazer gráficos
function renderCurrentLists() {
  if (ui.view === 'cartao') renderCartao();
  else if (ui.view === 'contas') renderContas();
  else if (ui.view === 'historico') renderHistory();
}

/* ─── Tema ─── */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('btnTheme').textContent = t === 'dark' ? '🌙' : '☀️';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0b0d12' : '#f3f4f7');
}
function currentTheme() {
  if (ui.theme) return ui.theme;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/* ─── PWA ───
   Hospedado (GitHub Pages etc.): usa manifest.webmanifest + sw.js (instalável e offline).
   Aberto como arquivo local: não há instalação (limitação dos navegadores). */
function initPWA() {
  if (!/^https?:$/.test(location.protocol) || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          showToast('Nova versão do app disponível.', { actionLabel: 'Atualizar', onAction: () => { nw.postMessage('skipWaiting'); setTimeout(() => location.reload(), 300); }, duration: 15000 });
        }
      });
    });
  }).catch(() => {});
}

/* ─── Eventos ─── */
function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('btnSettings').addEventListener('click', () => switchView(ui.view === 'ajustes' ? lastMainView : 'ajustes'));
  $('btnTheme').addEventListener('click', () => { ui.theme = currentTheme() === 'dark' ? 'light' : 'dark'; saveUI(); applyTheme(ui.theme); });
  $('syncPill').addEventListener('click', () => pullAll({ silent: false }));

  // Cartão
  $('expenseForm').addEventListener('submit', onSubmitExpense);
  $('btnCancelEdit').addEventListener('click', cancelEdit);
  $('cartaoChartMode').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { ui.cartaoChart = b.dataset.mode; saveUI(); renderCartaoChart(); }));
  $('expDate').addEventListener('change', () => { if (!editingId) $('expCompetencia').value = sanitizeDateStr($('expDate').value).slice(0, 7); });

  // Contas
  $('billsForm').addEventListener('submit', onSubmitBill);
  $('btnCancelEditBill').addEventListener('click', cancelEditBill);
  $('btnPrevBillsCycle').addEventListener('click', () => shiftBillsCompetencia(-1));
  $('btnNextBillsCycle').addEventListener('click', () => shiftBillsCompetencia(1));
  $('btnTodayBillsCycle').addEventListener('click', () => { resetBillsCompetencia(); shiftBillsCompetencia(0); });

  // Histórico
  $('btnFilterHistory').addEventListener('click', renderHistory);
  ['histSearchText'].forEach(id => $(id).addEventListener('input', renderHistory));
  ['histCatFilter', 'histCicloFilter', 'histStartDate', 'histEndDate'].forEach(id => $(id).addEventListener('change', renderHistory));

  // Veículo
  $('vehTabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => switchVehSub(b.dataset.sub)));
  $('fuelPills').querySelectorAll('.pill').forEach(p => p.addEventListener('click', () => selectFuel(p.dataset.fuel)));
  $('fPartial').addEventListener('input', previewConsumption);
  $('trajetoPills').querySelectorAll('.pill').forEach(p => p.addEventListener('click', () => selectTrajeto(p.dataset.trajeto)));
  ['flexEth', 'flexGas'].forEach(id => $(id).addEventListener('input', () => renderFlexCompare(vehicleStats(calcFuels()))));
  ['fPPL', 'fLit', 'fTot'].forEach(id => $(id).addEventListener('input', () => autoCalc('fPPL', 'fLit', 'fTot', 'pvPPL', 'pvLit', 'pvTot')));
  ['ePPL', 'eLit', 'eTot'].forEach(id => $(id).addEventListener('input', () => autoCalc('ePPL', 'eLit', 'eTot', 'epPPL', 'epLit', 'epTot')));
  ['fLinkCiclo', 'eLinkCiclo', 'doneLinkCiclo'].forEach(id =>
    $(id).querySelectorAll('button').forEach(b => b.addEventListener('click', () => setSeg(id, b.dataset.ciclo))));
  $('fLinkExpense').addEventListener('change', () => syncLinkUI('fLinkExpense', 'fLinkCiclo'));
  $('eLinkExpense').addEventListener('change', () => syncLinkUI('eLinkExpense', 'eLinkCiclo'));
  $('doneLinkExpense').addEventListener('change', () => syncLinkUI('doneLinkExpense', 'doneLinkCiclo'));
  $('btnSaveFuel').addEventListener('click', saveFuel);
  $('btnSaveEditFuel').addEventListener('click', saveEditFuel);
  $('btnUpdateOdo').addEventListener('click', askOdometer);
  $('btnConfirmOdo').addEventListener('click', confirmOdometer);
  $('btnSaveMaint').addEventListener('click', saveMaint);
  $('btnConfirmMaintDone').addEventListener('click', confirmMaintDone);
  $('currentTrip').addEventListener('input', () => {
    ui.currentTrip = $('currentTrip').value; saveUI();
    const fuels = calcFuels(); renderAutonomy(fuels, vehicleStats(fuels));
  });

  // Modais
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
  document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) closeModal(o.id); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(o => closeModal(o.id)); });

  // Ajustes
  $('btnSaveConfig').addEventListener('click', saveConfig);
  $('btnNextCycle').addEventListener('click', nextCycle);
  $('btnPullSheets').addEventListener('click', () => pullAll({ silent: false }));
  $('btnPushVehicle').addEventListener('click', () => {
    if (!confirm('Substituir o veículo da planilha pelo que está neste aparelho?')) return;
    queueVehicleFull(); showToast('Enviando veículo…');
  });
  $('btnSaveConn').addEventListener('click', saveConnection);
  $('btnDisconnect').addEventListener('click', disconnect);
  $('btnShowKey').addEventListener('click', () => { const i = $('cfgChave'); i.type = i.type === 'password' ? 'text' : 'password'; });
  $('btnSetupGo').addEventListener('click', () => { switchView('ajustes'); $('sheetsDetails').open = true; $('sheetsDetails').scrollIntoView({ behavior: 'smooth' }); });
  window.addEventListener('online', () => scheduleFlush(500));
  $('fixedForm').addEventListener('submit', onSubmitFixed);
  $('btnCancelFixed').addEventListener('click', cancelEditFixed);
  ['exp', 'bill'].forEach(px => $(px + 'ParcOn').addEventListener('change', () => $(px + 'ParcFields').classList.toggle('hidden', !$(px + 'ParcOn').checked)));
  $('btnDelParcelOne').addEventListener('click', () => resolveParcelDelete(false));
  $('btnDelParcelAll').addEventListener('click', () => resolveParcelDelete(true));
  $('btnImportLegacyLocal').addEventListener('click', () => applyImportedVehicle(store.json(LEGACY_FUEL_KEY, {}), 'este navegador'));
  $('btnImportLegacyUrl').addEventListener('click', importLegacyUrl);
  $('btnExportJson').addEventListener('click', exportJson);
  $('btnImportJson').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importJsonFile(f); e.target.value = ''; });

  // Redesenha gráficos ao girar/redimensionar
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => renderView(ui.view), 200); });
  // Ao voltar para o app, busca novidades (ex.: lançamentos feitos no PC)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !pulling) pullAll(); });
}

/* ─── Inicialização ─── */
function init() {
  applyTheme(currentTheme());
  initPWA();
  loadLocal();
  bindEvents();
  const t = todayISO();
  $('expDate').value = t;
  $('expCompetencia').value = t.slice(0, 7);
  $('billDate').value = t;
  $('histStartDate').value = state.startDate;
  $('histEndDate').value = state.endDate;
  $('currentTrip').value = ui.currentTrip || '';
  resetBillsCompetencia();
  $('billCompetencia').value = currentBillsCompetencia;
  ensureFixasInicio();
  $('fixedInicio').value = currentMonth();
  populateCategories();
  resetFuelForm();
  switchVehSub(ui.vehSub || 'abastecer');
  switchView(ui.view === 'ajustes' ? 'cartao' : (ui.view || 'cartao'));
  renderConnState();
  if (isConnected()) pullAll(); else finishSyncStatus();
}

export { VIEWS, afterDataChange, applyTheme, bindEvents, commit, currentTheme, init, initPWA, lastMainView, renderCurrentLists, renderView, switchView };
