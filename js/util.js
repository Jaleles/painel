/* ════════════════════════════════════════════════════════════
   PAINEL PESSOAL — núcleo (utilidades, estado, sincronização, gráficos)
════════════════════════════════════════════════════════════ */
const APP_VERSION = 'unificado-3';
const STORAGE_KEY = 'painel_pessoal_v1';
const LEGACY_GASTOS_KEY = 'teto_gastos_dates_v4';
const LEGACY_FUEL_KEY = 'fueltrack_v2';
const LEGACY_FUEL_URL_KEY = 'fueltrack_scripturl';
const BACKUP_KEY = 'painel_pessoal_backups';
const UI_KEY = 'painel_pessoal_ui';
const MAX_BACKUPS = 5;
// URL e chave da planilha NÃO ficam no código: são digitadas em Ajustes e guardadas só no aparelho
const CONN_KEY = 'painel_pessoal_conn';

const CARTAO_CATS = ['Alimentação', 'Transporte', 'Moradia', 'Lazer', 'Saúde', 'Outros'];
const MONTH_NAMES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const FUEL_LABELS = { gas: 'Gasolina', eth: 'Etanol', die: 'Diesel' };
const FUEL_ICONS = { gas: '⛽', eth: '🌿', die: '🔵' };
const FUEL_COLORS = { gas: '#f59e0b', eth: '#22c55e', die: '#38bdf8' };

const $ = id => document.getElementById(id);

// localStorage protegido (modo privado, bloqueio de cookies etc.)
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } },
  json(k, fallback) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fallback; } catch (_) { return fallback; } }
};

/* ─── Utilidades ─── */
function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayISO = () => toISODate(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const round2 = v => Math.round((Number(v) || 0) * 100) / 100;

// Aceita "1.234,56", "45,9", "45.90", "45"
function parseMoneyInput(raw) {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(s);
}
const parseNum = parseMoneyInput;
const toInputNum = v => (v === null || v === undefined || v === '' || isNaN(v)) ? '' : String(v).replace('.', ',');

function sanitizeDateStr(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (str.includes('T') && /^\d{4}-/.test(str)) return str.split('T')[0];
  if (str.includes('/')) {
    const p = str.split('/');
    if (p.length === 3) {
      if (p[2].length === 4) return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
      if (p[0].length === 4) return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
    }
  }
  if (str.includes('-')) {
    const p = str.split('-');
    if (p.length === 3 && p[2].length === 4) return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
  }
  // Ex.: "Tue Sep 01 2026 00:00:00 GMT-0300" (datas convertidas pelo Sheets no FuelTrack antigo)
  const t = Date.parse(str);
  if (!isNaN(t)) return toISODate(new Date(t));
  return str;
}

function normMonth(raw, fallbackDate) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  if (s) {
    const d = sanitizeDateStr(s);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d.slice(0, 7);
  }
  return fallbackDate ? sanitizeDateStr(fallbackDate).slice(0, 7) : '';
}

const formatBRL = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN = (v, d = 2) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDateBR = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const fmtDM = iso => { if (!iso) return ''; const [, m, d] = iso.split('-'); return `${d}/${m}`; };
const monthLabel = comp => { const [y, m] = comp.split('-'); return `${MONTH_NAMES_PT[+m - 1]}/${y}`; };
const monthShort = comp => { const [y, m] = comp.split('-'); return `${MONTH_SHORT[+m - 1]}/${y.slice(2)}`; };
function compactBRL(v) {
  const a = Math.abs(v);
  if (a >= 1000) return 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
  return 'R$ ' + Math.round(v);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n[k] = v;
    else n.setAttribute(k, v);
  });
  children.flat().forEach(c => { if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return n;
}
const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };

/* ─── Toast ─── */
function showToast(message, { error = false, actionLabel = null, onAction = null, duration = 3500 } = {}) {
  const t = el('div', { class: 'toast' + (error ? ' error' : '') }, el('span', {}, message));
  if (actionLabel && onAction) t.append(el('button', { onclick: () => { onAction(); t.remove(); } }, actionLabel));
  $('toastContainer').append(t);
  setTimeout(() => t.remove(), duration);
}

export { $, APP_VERSION, BACKUP_KEY, CARTAO_CATS, CONN_KEY, FUEL_COLORS, FUEL_ICONS, FUEL_LABELS, LEGACY_FUEL_KEY, LEGACY_FUEL_URL_KEY, LEGACY_GASTOS_KEY, MAX_BACKUPS, MONTH_NAMES_PT, MONTH_SHORT, STORAGE_KEY, UI_KEY, compactBRL, el, esc, fmtDM, fmtDateBR, fmtN, formatBRL, monthLabel, monthShort, normMonth, parseMoneyInput, parseNum, round2, sanitizeDateStr, showToast, store, toISODate, toInputNum, todayISO, uid, vibrate };
