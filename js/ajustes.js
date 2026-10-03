import { afterDataChange, commit } from './app.js';
import { conn, hasVehicleData, isConnected, makeDefaultState, normalizeExpense, normalizeFixa, normalizeVehicle, persist, saveBackup, saveConn, setState, state, vehicleSnapshot } from './estado.js';
import { resetBillsCompetencia } from './gastos/contas.js';
import { apiPost, clearSyncError, enqueue, enqueueRaw, finishSyncStatus, pullAll, queueVehicleFull, scheduleFlush, testConnection } from './sync.js';
import { $, APP_VERSION, BACKUP_KEY, LEGACY_FUEL_KEY, LEGACY_FUEL_URL_KEY, el, fmtDateBR, fmtN, parseMoneyInput, sanitizeDateStr, showToast, store, toISODate, toInputNum, todayISO } from './util.js';
import { resetFuelForm } from './veiculo/abastecer.js';

/* ─── Ajustes ─── */
function fillConfigForm() {
  $('cfgStartDate').value = state.startDate;
  $('cfgEndDate').value = state.endDate;
  $('cfgLimit').value = toInputNum(state.monthlyLimit || '');
  $('cfgInitial').value = toInputNum(state.initialSpent || '');
  $('cfgCardInvoice').value = state.cardInvoiceName || '';
  $('cfgTotalLimit').value = toInputNum(state.totalLimit || '');
  $('cfgScriptUrl').value = conn.url || '';
  $('cfgChave').value = conn.chave || '';
  $('cfgFuelLinkDefault').checked = !!state.fuelLinkDefault;
  $('cfgFuelCiclo').value = state.fuelCiclo || 'cartao';
}

function configPayload() {
  return {
    startDate: state.startDate, endDate: state.endDate, monthlyLimit: state.monthlyLimit,
    initialSpent: state.initialSpent, totalLimit: state.totalLimit,
    odoBase: state.odoBase, cardInvoiceName: state.cardInvoiceName || ''
  };
}
function pushConfig() { enqueue('config', 'saveConfig', { config: configPayload() }); }

const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/;
async function saveConnection() {
  const url = $('cfgScriptUrl').value.trim();
  const chave = $('cfgChave').value.trim();
  if (!URL_RE.test(url)) return showToast('A URL deve começar com https://script.google.com/macros/s/ e terminar com /exec', { error: true, duration: 5000 });
  if (chave.length < 16) return showToast('Cole a chave gerada na planilha (menu Painel Pessoal).', { error: true });
  const btn = $('btnSaveConn');
  btn.disabled = true; btn.textContent = 'Testando…';
  try {
    await testConnection(url, chave);
    Object.assign(conn, { url, chave }); saveConn();
    clearSyncError();
    showToast('✅ Conectado à planilha.');
    renderConnState();
    await pullAll({ silent: false });
  } catch (err) {
    showToast('❌ ' + err.message, { error: true, duration: 6000 });
  } finally {
    btn.disabled = false; btn.textContent = '🔌 Testar e conectar';
  }
}
function disconnect() {
  if (!confirm('Desconectar este aparelho da planilha? A URL e a chave são apagadas daqui (os dados locais ficam).')) return;
  Object.assign(conn, { url: '', chave: '' }); saveConn();
  fillConfigForm(); renderConnState(); finishSyncStatus();
}
function renderConnState() {
  const ok = isConnected();
  $('connStatus').className = 'banner ' + (ok ? 'info' : 'warn') + ' show';
  $('connStatus').textContent = ok ? '🔒 Conectado. URL e chave ficam guardadas só neste aparelho.' : 'Não conectado. Cole a URL do Apps Script e a chave gerada na planilha.';
  $('setupBanner').classList.toggle('hidden', ok);
}

function saveConfig() {
  const s = sanitizeDateStr($('cfgStartDate').value), e = sanitizeDateStr($('cfgEndDate').value);
  if (!s || !e || s > e) return showToast('Confira as datas do ciclo do Cartão.', { error: true });
  state.startDate = s; state.endDate = e;
  state.monthlyLimit = parseMoneyInput($('cfgLimit').value) || 0;
  state.initialSpent = parseMoneyInput($('cfgInitial').value) || 0;
  state.totalLimit = parseMoneyInput($('cfgTotalLimit').value) || 0;
  state.cardInvoiceName = $('cfgCardInvoice').value.trim();
  state.fuelLinkDefault = $('cfgFuelLinkDefault').checked;
  state.fuelCiclo = $('cfgFuelCiclo').value;
  resetBillsCompetencia();
  persist();
  resetFuelForm();
  pushConfig();
  showToast('Ajustes salvos.');
}

function nextCycle() {
  if (!confirm('Avançar o ciclo do Cartão em 1 mês? O gasto inicial volta a zero.')) return;
  const addMonth = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    const last = new Date(y, m + 1, 0).getDate(); // último dia do mês seguinte
    return toISODate(new Date(y, m, Math.min(d, last)));
  };
  state.startDate = addMonth(state.startDate);
  state.endDate = addMonth(state.endDate);
  state.initialSpent = 0;
  persist();
  fillConfigForm();
  pushConfig();
  showToast(`Novo ciclo: ${fmtDateBR(state.startDate)} a ${fmtDateBR(state.endDate)}`);
}

/* ─── Backups ─── */
function renderBackups() {
  const box = $('backupList');
  const list = store.json(BACKUP_KEY, []);
  box.innerHTML = '';
  if (!list.length) { box.append(el('div', { class: 'empty', style: 'padding:8px' }, 'Nenhum backup ainda (é criado automaticamente após sincronizar, no máximo a cada 6 h, e antes de importações).')); return; }
  list.forEach((b, i) => box.append(el('div', { class: 'item' },
    el('div', { class: 'item-info' },
      el('span', { class: 'item-title' }, new Date(b.ts).toLocaleString('pt-BR')),
      el('div', { class: 'item-sub' }, `${b.expenses} despesas · ${b.fuels} abastecimentos` + (b.reason !== 'auto' ? ` · ${b.reason}` : ''))),
    el('button', { class: 'btn sm ghost', onclick: () => restoreBackup(i) }, '↩️ Restaurar'))));
}
function restoreBackup(i) {
  const b = store.json(BACKUP_KEY, [])[i];
  if (!b || !confirm('Restaurar este backup?\n\nOs dados dele serão reenviados para a planilha: despesas e fixas são regravadas (as que existem só na planilha continuam lá) e o veículo da planilha é substituído pelo do backup.')) return;
  saveBackup('antes de restaurar');
  replaceStateAndPush(JSON.parse(b.data));
  showToast('✅ Backup restaurado. Enviando para a planilha…');
}
function replaceStateAndPush(s) {
  const keep = { outbox: state.outbox, syncedOnce: state.syncedOnce };
  setState({ ...makeDefaultState(), ...s, ...keep });
  state.expenses = (state.expenses || []).map(normalizeExpense);
  state.fixedItems = (state.fixedItems || []).map(normalizeFixa);
  Object.assign(state, normalizeVehicle(state));
  delete state.pendingDeletes; delete state.vehicleDirty; delete state.scriptUrl; delete state.odometer;
  state.expenses.forEach(e => enqueueRaw('exp:' + e.id, 'saveExpense', { item: e }));
  state.fixedItems.forEach(f => enqueueRaw('fix:' + f.id, 'saveFixed', { item: f }));
  enqueueRaw('config', 'saveConfig', { config: configPayload() });
  enqueueRaw('vehicle:full', 'saveVehicle', { vehicle: vehicleSnapshot() });
  persist();
  afterDataChange();
  scheduleFlush(100);
}
function exportJson() {
  const data = { app: 'painel-pessoal', version: APP_VERSION, exportedAt: new Date().toISOString(), state: { ...state, outbox: [] } };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `painel-pessoal-${todayISO()}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importJsonFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const s = parsed.state || parsed;
      if (!Array.isArray(s.expenses) && !Array.isArray(s.fuels)) throw new Error('Arquivo não reconhecido');
      if (!confirm('Importar este arquivo?\n\nDespesas e fixas dele são gravadas na planilha (as que existem só na planilha continuam) e o veículo da planilha é substituído pelo do arquivo. Um backup local é criado antes.')) return;
      saveBackup('antes de importar');
      replaceStateAndPush(s);
      showToast('✅ Arquivo importado. Enviando para a planilha…');
    } catch (err) {
      showToast('❌ Não foi possível importar: ' + err.message, { error: true });
    }
  };
  reader.readAsText(file);
}

/* ─── Importação do FuelTrack antigo ─── */
function renderLegacyInfo() {
  const f = store.json(LEGACY_FUEL_KEY, null);
  const banner = $('legacyLocalBanner');
  const btn = $('btnImportLegacyLocal');
  if (f && hasVehicleData(f)) {
    banner.textContent = `Encontrei dados do FuelTrack neste navegador: ${(f.fuels || []).length} abastecimento(s), hodômetro ${fmtN(f.odometer || 0, 0)} km.`;
    banner.classList.add('show'); btn.classList.remove('hidden');
  } else { banner.classList.remove('show'); btn.classList.add('hidden'); }
  const oldUrl = store.get(LEGACY_FUEL_URL_KEY);
  if (oldUrl && !$('legacyUrl').value) $('legacyUrl').value = oldUrl;
}
function applyImportedVehicle(v, origin) {
  const nv = normalizeVehicle(v);
  if (!hasVehicleData(nv)) return showToast('Nenhum dado de veículo encontrado.', { error: true });
  const msg = `Importar ${nv.fuels.length} abastecimento(s) e ${nv.maintenances.length} manutenção(ões) de ${origin}?` +
    (hasVehicleData(state) ? '\n\nOs dados de veículo atuais serão substituídos (um backup será criado antes).' : '');
  if (!confirm(msg)) return;
  saveBackup('antes de importar FuelTrack');
  Object.assign(state, nv);
  queueVehicleFull();
  commit();
  showToast(`✅ ${nv.fuels.length} abastecimento(s) importado(s).`);
  // Abastecimentos antigos não viram despesas automaticamente (evita duplicar gastos já lançados à mão)
}
async function importLegacyUrl() {
  const url = $('legacyUrl').value.trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) return showToast('Cole a URL /exec do Apps Script antigo do FuelTrack.', { error: true });
  const btn = $('btnImportLegacyUrl');
  btn.disabled = true; btn.textContent = 'Buscando…';
  try {
    const res = await apiPost({ action: 'loadAll' }, { url, chave: '' });
    if (!res.data) throw new Error('Resposta sem dados');
    applyImportedVehicle(res.data, 'planilha antiga');
  } catch (err) {
    showToast('❌ ' + err.message, { error: true });
  } finally {
    btn.disabled = false; btn.textContent = '☁️ Importar da planilha antiga';
  }
}

export { URL_RE, applyImportedVehicle, configPayload, disconnect, exportJson, fillConfigForm, importJsonFile, importLegacyUrl, nextCycle, pushConfig, renderBackups, renderConnState, renderLegacyInfo, replaceStateAndPush, restoreBackup, saveConfig, saveConnection };
