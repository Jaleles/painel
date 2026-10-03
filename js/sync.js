import { saveConfig } from './ajustes.js';
import { afterDataChange, renderCurrentLists } from './app.js';
import { conn, hasVehicleData, isConnected, normalizeExpense, normalizeFixa, normalizeFuel, normalizeHist, normalizeMaint, normalizeVehicle, persist, saveBackup, state, vehicleSnapshot } from './estado.js';
import { deleteFixed, ensureFixasInicio } from './gastos/fixas.js';
import { $, sanitizeDateStr, showToast } from './util.js';
import { saveFuel } from './veiculo/abastecer.js';
import { deleteFuel } from './veiculo/historico.js';
import { deleteMaint, saveMaint } from './veiculo/manutencao.js';

/* ─── Status de sincronização ─── */
function setSync(type, msg) {
  $('syncDot').className = 'sync-dot ' + (type || '');
  $('syncText').textContent = msg;
}
const pendingCount = () => state.outbox.length;
const isPending = k => state.outbox.some(o => o.k === k);
function refreshSyncBadge() {
  if (!isConnected()) { setSync('', 'Conecte a planilha em Ajustes ⚙️'); return; }
  const p = pendingCount();
  if (p > 0) setSync('pending', `${p} alteração(ões) a enviar`);
}
function showSyncError(msg) {
  const b = $('syncErrorBanner');
  b.textContent = msg; b.classList.add('show');
}
function clearSyncError() { $('syncErrorBanner').classList.remove('show'); }
function finishSyncStatus() {
  const p = pendingCount();
  if (!isConnected()) setSync('', 'Conecte a planilha em Ajustes ⚙️');
  else if (p > 0) setSync('pending', `${p} alteração(ões) a enviar`);
  else setSync('online', 'Sincronizado · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
}

/* ─── API Apps Script ─── */
const backend = { version: null };

async function apiPost(body, { url = conn.url, chave = conn.chave } = {}) {
  if (!url) throw new Error('URL do Apps Script não configurada');
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, chave }) });
  let data;
  try { data = await res.json(); } catch (_) { throw new Error('Resposta inválida do servidor (confira a URL e se o script foi publicado como "Qualquer pessoa")'); }
  if (data && (data.status === 'error' || data.ok === false)) {
    const err = new Error(data.message || data.error || 'Servidor retornou erro');
    err.code = data.code; err.done = data.done;
    throw err;
  }
  return data || {};
}

function handleApiError(err, context) {
  if (err.code === 'CHAVE_INVALIDA' || err.code === 'SEM_CHAVE') {
    setSync('offline', err.code === 'SEM_CHAVE' ? 'Planilha sem chave' : 'Chave inválida');
    showSyncError('🔐 ' + err.message + ' Confira em Ajustes → Google Sheets.');
    return;
  }
  if (/Ação desconhecida/i.test(err.message)) {
    setSync('offline', 'Script desatualizado');
    showSyncError('⚠️ A planilha está com uma versão antiga do Apps Script. Cole o AppsScript_Unificado.gs novo e publique uma nova versão.');
    return;
  }
  const network = err instanceof TypeError; // fetch falhou: sem internet / servidor inacessível
  if (network) {
    setSync('offline', 'Sem conexão');
    showSyncError('Sem conexão com a planilha agora. Tudo continua salvo neste aparelho e será enviado quando a conexão voltar.');
  } else {
    setSync('offline', 'Erro na planilha');
    showSyncError(`A planilha respondeu com um erro: "${err.message}". Suas alterações continuam guardadas neste aparelho. Se persistir, envie esta mensagem para ajuste.`);
  }
}

/* ─── Fila de envio (outbox) ───
   Cada alteração vira uma operação com chave única (ex.: "fuel:abc"). Uma nova
   operação com a mesma chave substitui a anterior (só a versão mais recente vai).
   A fila é enviada em lote e só sai do aparelho quando a planilha confirma. */
function enqueueRaw(k, action, body) {
  state.outbox = state.outbox.filter(o => o.k !== k);
  if (k === 'vehicle:full') state.outbox = state.outbox.filter(o => !/^(fuel|maint|mhist):/.test(o.k));
  state.outbox.push({ k, action, body });
}
function enqueue(k, action, body) {
  enqueueRaw(k, action, body);
  persist();
  refreshSyncBadge();
  if (typeof renderCurrentLists === 'function') setTimeout(renderCurrentLists, 0);
  scheduleFlush();
}

let flushTimer = null, flushing = false;
function scheduleFlush(ms = 350) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); }

async function flush() {
  if (flushing || !isConnected() || !state.outbox.length) { if (!flushing) finishSyncStatus(); return true; }
  flushing = true;
  try {
    while (state.outbox.length) {
      const ops = state.outbox.slice(0, 40);
      setSync('syncing', `Enviando ${state.outbox.length} alteração(ões)…`);
      try {
        await apiPost({ action: 'batch', ops: ops.map(o => ({ action: o.action, ...o.body })) });
        removeSent(ops, ops.length);
      } catch (err) {
        if (err.done) removeSent(ops, err.done);
        throw err;
      }
    }
    clearSyncError();
    finishSyncStatus();
    renderCurrentLists();
    return true;
  } catch (err) {
    handleApiError(err, 'push');
    return false;
  } finally {
    flushing = false;
  }
}
// Remove da fila só as operações confirmadas (e que não foram substituídas nesse meio-tempo)
function removeSent(ops, n) {
  const sent = new Set(ops.slice(0, n));
  state.outbox = state.outbox.filter(o => !sent.has(o));
  persist();
}

// Atalhos usados pelo resto do app
const cleanExpense = e => { const x = normalizeExpense(e); return x; };
function syncExpense(_action, exp) { enqueue('exp:' + exp.id, 'saveExpense', { item: cleanExpense(exp) }); }
function deleteExpenseRemote(id) { enqueue('exp:' + id, 'deleteExpense', { id: String(id) }); }
function saveFixedRemote(fx) { enqueue('fix:' + fx.id, 'saveFixed', { item: fx }); }
function deleteFixedRemote(id) { enqueue('fix:' + id, 'deleteFixed', { id: String(id) }); }
function queueFuel(f) { enqueue('fuel:' + f.id, 'saveFuel', { item: f }); }
function queueFuelDelete(id) { enqueue('fuel:' + id, 'deleteFuel', { id: String(id) }); }
function queueMaint(m) { const { history, ...item } = m; enqueue('maint:' + m.id, 'saveMaint', { item }); }
function queueMaintDelete(id) { enqueue('maint:' + id, 'deleteMaint', { id: String(id) }); }
function queueHist(maintId, h) { enqueue('mhist:' + h.id, 'saveMaintHist', { maintId, item: h }); }
function queueVehicleFull() { enqueue('vehicle:full', 'saveVehicle', { vehicle: vehicleSnapshot() }); }

/* ─── Buscar tudo da planilha ─── */
let pulling = false;
async function pullAll({ silent = true } = {}) {
  if (!isConnected()) { finishSyncStatus(); return; }
  if (pulling) return;
  pulling = true;
  try {
    await flush();                       // manda o que está pendente antes de buscar
    setSync('syncing', 'Buscando da planilha…');
    const data = await apiPost({ action: 'getAll' });
    backend.version = data.version || '';
    applyServerData(data);
    persist();
    clearSyncError();
    afterDataChange();
    if (state.outbox.length) scheduleFlush(100);
    finishSyncStatus();
    saveBackup('auto');
    if (!silent) showToast('☁️ Sincronizado com a planilha.');
  } catch (err) {
    handleApiError(err, 'pull');
    if (!silent) showToast('❌ ' + (err.message || 'Falha na conexão'), { error: true });
  } finally {
    pulling = false;
  }
}

// A planilha é a fonte da verdade; o que ainda está na fila é reaplicado por cima
function applyServerData(data) {
  const c = data.config || {};
  ['monthlyLimit', 'initialSpent', 'totalLimit', 'odoBase'].forEach(k => {
    if (c[k] !== undefined && c[k] !== null && c[k] !== '') state[k] = Number(c[k]) || 0;
  });
  const s = sanitizeDateStr(c.startDate), e = sanitizeDateStr(c.endDate);
  if (s) state.startDate = s;
  if (e) state.endDate = e;
  if (c.cardInvoiceName !== undefined) state.cardInvoiceName = String(c.cardInvoiceName || '');

  state.expenses = (data.expenses || []).map(normalizeExpense);
  state.fixedItems = (data.fixedItems || []).map(normalizeFixa);
  if (data.vehicle) {
    const sv = normalizeVehicle(data.vehicle);
    // 1ª sincronização com a planilha nova: se ela não tem veículo e este aparelho tem, envia o daqui
    if (!state.syncedOnce && !hasVehicleData(sv) && hasVehicleData(state)) enqueueRaw('vehicle:full', 'saveVehicle', { vehicle: vehicleSnapshot() });
    else Object.assign(state, sv);
  }
  state.syncedOnce = true;
  state.outbox.forEach(applyOp);
  ensureFixasInicio({ push: true });
}

function upsertById(list, item) {
  const i = list.findIndex(x => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
}
function applyOp(op) {
  const b = op.body;
  switch (op.action) {
    case 'saveExpense': upsertById(state.expenses, normalizeExpense(b.item)); break;
    case 'deleteExpense': state.expenses = state.expenses.filter(x => x.id !== b.id); break;
    case 'saveFixed': upsertById(state.fixedItems, normalizeFixa(b.item)); break;
    case 'deleteFixed': state.fixedItems = state.fixedItems.filter(x => x.id !== b.id); break;
    case 'saveFuel': upsertById(state.fuels, normalizeFuel(b.item)); break;
    case 'deleteFuel': state.fuels = state.fuels.filter(x => x.id !== b.id); break;
    case 'saveMaint': {
      const cur = state.maintenances.find(x => x.id === b.item.id);
      upsertById(state.maintenances, normalizeMaint({ ...b.item, history: cur ? cur.history : [] }));
      break;
    }
    case 'deleteMaint': state.maintenances = state.maintenances.filter(x => x.id !== b.id); break;
    case 'saveMaintHist': {
      const m = state.maintenances.find(x => x.id === b.maintId);
      if (m) { const h = normalizeHist(b.item, 0, m.id); upsertById(m.history, h); m.history.sort((x, y) => y.date.localeCompare(x.date)); }
      break;
    }
    case 'saveConfig': {
      const c = b.config || {};
      ['monthlyLimit', 'initialSpent', 'totalLimit', 'odoBase'].forEach(k => { if (c[k] !== undefined) state[k] = Number(c[k]) || 0; });
      if (c.startDate) state.startDate = c.startDate;
      if (c.endDate) state.endDate = c.endDate;
      if (c.cardInvoiceName !== undefined) state.cardInvoiceName = c.cardInvoiceName;
      break;
    }
    case 'saveVehicle': Object.assign(state, normalizeVehicle(b.vehicle)); break;
  }
}

async function testConnection(url, chave) {
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  let info;
  try { info = await res.json(); } catch (_) { throw new Error('A URL não respondeu como o Apps Script do Painel. Confira se copiou a URL /exec da implantação.'); }
  if (info.app !== 'painel-pessoal') throw new Error('Esse Apps Script é de uma versão antiga. Cole o script novo e publique uma nova versão.');
  if (!info.chaveDefinida) throw new Error('A planilha ainda não tem chave. Abra a planilha → menu Painel Pessoal → Gerar nova chave de acesso.');
  await apiPost({ action: 'ping' }, { url, chave });
  return info;
}

export { apiPost, applyOp, applyServerData, backend, cleanExpense, clearSyncError, deleteExpenseRemote, deleteFixedRemote, enqueue, enqueueRaw, finishSyncStatus, flush, flushTimer, flushing, handleApiError, isPending, pendingCount, pullAll, pulling, queueFuel, queueFuelDelete, queueHist, queueMaint, queueMaintDelete, queueVehicleFull, refreshSyncBadge, removeSent, saveFixedRemote, scheduleFlush, setSync, showSyncError, syncExpense, testConnection, upsertById };
