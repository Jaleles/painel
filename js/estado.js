import { enqueueRaw } from './sync.js';
import { BACKUP_KEY, CONN_KEY, LEGACY_FUEL_KEY, LEGACY_GASTOS_KEY, MAX_BACKUPS, STORAGE_KEY, UI_KEY, normMonth, sanitizeDateStr, showToast, store } from './util.js';

/* ─── Estado ─── */
function defaultCycle() {
  const t = new Date();
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  const ym = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
  return { startDate: `${ym}-01`, endDate: `${ym}-${String(last).padStart(2, '0')}` };
}

function makeDefaultState() {
  const c = defaultCycle();
  return {
    // Gastos
    startDate: c.startDate, endDate: c.endDate,
    monthlyLimit: 3000, initialSpent: 0, totalLimit: 0,
    billsStartDay: 2, billsEndDay: 10,
    expenses: [],        // { id, date, desc, cat, value, ciclo, competencia, fixedId?, origem? }
    fixedItems: [],      // { id, desc, cat, refValue, dueDay, inicio, fim }
    // Veículo
    odoBase: 0,          // hodômetro antes do 1º abastecimento registrado (total = odoBase + soma dos km)
    fuels: [],           // { id, ord, date, partial, fuelType, trajeto, pricePerLiter, liters, total, note, expenseCiclo }
    maintenances: [],    // { id, name, interval, lastOdo, warnKm, cost, history:[{ id, date, odo, cost, note, expenseCiclo }] }
    // Fila de envio para a planilha: [{ k, action, body }] — a planilha é a fonte da verdade
    outbox: [],
    // Preferências
    fuelLinkDefault: true,
    fuelCiclo: 'cartao',
    cardInvoiceName: ''    // nome da fatura do cartão principal (evita contar em dobro em Contas)
  };
}

let state = makeDefaultState();
let ui = Object.assign({ theme: null, view: 'cartao', vehSub: 'abastecer', currentTrip: '' }, store.json(UI_KEY, {}));
const saveUI = () => store.set(UI_KEY, JSON.stringify(ui));

// Conexão (URL + chave) fica separada do estado: não vai para backups nem arquivos exportados
let conn = Object.assign({ url: '', chave: '' }, store.json(CONN_KEY, {}));
const saveConn = () => store.set(CONN_KEY, JSON.stringify(conn));
const isConnected = () => !!(conn.url && conn.chave);

function normalizeExpense(e) {
  const date = sanitizeDateStr(e.date);
  return {
    id: String(e.id),
    date,
    desc: String(e.desc || 'Sem descrição'),
    cat: String(e.cat || 'Outros'),
    value: Number(e.value) || 0,
    ciclo: e.ciclo === 'contas' ? 'contas' : 'cartao',
    competencia: normMonth(e.competencia, date),
    fixedId: e.fixedId ? String(e.fixedId) : null,
    origem: e.origem || ''
  };
}

function normalizeFixa(f) {
  return {
    id: String(f.id), desc: f.desc || '', cat: f.desc || f.cat || 'Outros', refValue: Number(f.refValue) || 0,
    dueDay: f.dueDay ? Number(f.dueDay) : null,
    inicio: normMonth(f.inicio), fim: normMonth(f.fim)
  };
}

function normalizeFuel(f) {
  return {
    id: String(f.id), ord: Number(f.ord) || 0, date: sanitizeDateStr(f.date), partial: Number(f.partial) || 0,
    fuelType: ['gas', 'eth', 'die'].includes(f.fuelType) ? f.fuelType : 'gas',
    trajeto: ['cidade', 'estrada', 'misto'].includes(f.trajeto) ? f.trajeto : '',
    pricePerLiter: Number(f.pricePerLiter) || 0, liters: Number(f.liters) || 0, total: Number(f.total) || 0,
    calcField: ['total', 'liters', 'pricePerLiter'].includes(f.calcField) ? f.calcField : '',
    note: f.note && f.note !== 'undefined' ? String(f.note) : '',
    expenseCiclo: f.expenseCiclo === 'cartao' || f.expenseCiclo === 'contas' ? f.expenseCiclo : ''
  };
}
function normalizeHist(h, i, mid) {
  return {
    id: h.id ? String(h.id) : `${mid}_${i}`, date: sanitizeDateStr(h.date), odo: Number(h.odo) || 0,
    cost: Number(h.cost) || 0, note: h.note && h.note !== 'undefined' ? String(h.note) : '',
    expenseCiclo: h.expenseCiclo === 'cartao' || h.expenseCiclo === 'contas' ? h.expenseCiclo : ''
  };
}
function normalizeMaint(m) {
  return {
    id: String(m.id), name: String(m.name || ''), interval: Number(m.interval) || 0,
    lastOdo: Number(m.lastOdo) || 0, warnKm: Number(m.warnKm) || 500, cost: Number(m.cost) || 0,
    history: (m.history || []).map((h, i) => normalizeHist(h, i, m.id))
  };
}

// Aceita o formato novo (odoBase) e o antigo (odometer = hodômetro total)
function normalizeVehicle(v) {
  const fuels = (v.fuels || []).filter(f => f && f.id).map(normalizeFuel);
  const sum = fuels.reduce((a, f) => a + f.partial, 0);
  const odoBase = v.odoBase !== undefined && v.odoBase !== null ? Number(v.odoBase) || 0
    : Math.max(0, (Number(v.odometer) || 0) - sum);
  return { odoBase, fuels, maintenances: (v.maintenances || []).filter(m => m && m.id).map(normalizeMaint) };
}

function hasVehicleData(v) {
  return (v.fuels && v.fuels.length) || (v.maintenances && v.maintenances.length) || Number(v.odometer) > 0 || Number(v.odoBase) > 0;
}

const sumPartials = () => state.fuels.reduce((a, f) => a + (Number(f.partial) || 0), 0);
const getOdometer = () => (Number(state.odoBase) || 0) + sumPartials();

function loadLocal() {
  let parsed = store.json(STORAGE_KEY, null);
  let migrated = [];
  if (!parsed) {
    // 1ª execução: aproveita os dados dos apps antigos se estiverem neste navegador
    parsed = {};
    const g = store.json(LEGACY_GASTOS_KEY, null);
    if (g) {
      ['startDate', 'endDate', 'monthlyLimit', 'initialSpent', 'totalLimit', 'expenses', 'fixedItems', 'scriptUrl']
        .forEach(k => { if (g[k] !== undefined) parsed[k] = g[k]; });
      migrated.push('Teto de Gastos');
    }
    const f = store.json(LEGACY_FUEL_KEY, null);
    if (f && hasVehicleData(f)) {
      Object.assign(parsed, normalizeVehicle(f));
      parsed.vehicleDirty = true;
      migrated.push('FuelTrack');
    }
  }
  const base = makeDefaultState();
  const legacyUrl = parsed.scriptUrl;
  state = { ...base, ...parsed };
  state.expenses = (state.expenses || []).map(normalizeExpense);
  state.fixedItems = (state.fixedItems || []).map(normalizeFixa);
  Object.assign(state, normalizeVehicle(state));
  state.outbox = Array.isArray(state.outbox) ? state.outbox : [];
  state.startDate = sanitizeDateStr(state.startDate) || base.startDate;
  state.endDate = sanitizeDateStr(state.endDate) || base.endDate;

  // Migração das versões anteriores (v1/v2): pendências viram itens da fila
  (parsed.expenses || []).filter(e => e.synced === false).forEach(e => enqueueRaw('exp:' + e.id, 'saveExpense', { item: normalizeExpense(e) }));
  (parsed.pendingDeletes || []).forEach(id => enqueueRaw('exp:' + id, 'deleteExpense', { id: String(id) }));
  delete state.pendingDeletes; delete state.vehicleDirty; delete state.odometer; delete state.scriptUrl;
  if (!conn.url && legacyUrl) { conn.url = legacyUrl; saveConn(); }

  persist();
  if (migrated.length) setTimeout(() => showToast(`Dados importados de: ${migrated.join(' + ')}`), 600);
}

// Troca o estado inteiro (restaurar backup / importar arquivo)
function setState(next) { state = next; }

function persist() {
  if (!store.set(STORAGE_KEY, JSON.stringify(state))) {
    showToast('Não foi possível salvar localmente (armazenamento do navegador indisponível).', { error: true });
  }
}

function vehicleSnapshot() {
  return { odoBase: state.odoBase, fuels: state.fuels, maintenances: state.maintenances };
}

/* ─── Backups locais ─── */
function saveBackup(reason = 'auto') {
  const list = store.json(BACKUP_KEY, []);
  const now = Date.now();
  if (reason === 'auto' && list[0] && now - list[0].ts < 6 * 60 * 60 * 1000) return; // automático: no máx. a cada 6 h
  const snap = { ...state, outbox: [] };
  list.unshift({ ts: now, reason, expenses: state.expenses.length, fuels: state.fuels.length, data: JSON.stringify(snap) });
  store.set(BACKUP_KEY, JSON.stringify(list.slice(0, MAX_BACKUPS)));
}

export { conn, defaultCycle, getOdometer, hasVehicleData, isConnected, loadLocal, makeDefaultState, normalizeExpense, normalizeFixa, normalizeFuel, normalizeHist, normalizeMaint, normalizeVehicle, persist, saveBackup, saveConn, saveUI, setState, state, sumPartials, ui, vehicleSnapshot };
