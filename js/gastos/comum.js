import { state } from '../estado.js';
import { startEditExpense } from './cartao.js';
import { startEditBillExpense } from './contas.js';
import { confirmDeleteExpense } from './exclusao.js';
import { isPending } from '../sync.js';
import { $, CARTAO_CATS, el, fmtDM, formatBRL, sanitizeDateStr, toISODate, todayISO } from '../util.js';

/* ════════════════════════════════════════════════════════════
   GASTOS — Cartão, Contas, Teto Total, Histórico, Fixas
════════════════════════════════════════════════════════════ */

const expenseCompetencia = item => item.competencia || sanitizeDateStr(item.date).slice(0, 7);
const sumValues = list => list.reduce((a, e) => a + (Number(e.value) || 0), 0);
const currentMonth = () => todayISO().slice(0, 7);
function addMonths(comp, n) {
  const [y, m] = comp.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function addMonthsDate(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();
  return toISODate(new Date(y, m - 1 + n, Math.min(d, last)));
}
function dateInComp(comp, day) {
  const [y, m] = comp.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${comp}-${String(Math.min(day || last, last)).padStart(2, '0')}`;
}
const isFixaActive = (f, comp) => (!f.inicio || comp >= f.inicio) && (!f.fim || comp <= f.fim);
const activeFixasFor = comp => state.fixedItems.filter(f => isFixaActive(f, comp));
const parcelaInfo = e => {
  const m = /^parcela:([^:]+):(\d+)\/(\d+)$/.exec(e.origem || '');
  return m ? { group: m[1], n: +m[2], total: +m[3] } : null;
};
function matchesCardInvoice(...texts) {
  const name = String(state.cardInvoiceName || '').trim().toLowerCase();
  if (!name) return false;
  return texts.some(t => String(t || '').toLowerCase().includes(name));
}

/* ─── Categorias ─── */
function populateCategories() {
  const names = Array.from(new Set(state.fixedItems.map(f => f.desc).filter(Boolean)));
  const activeNames = Array.from(new Set(state.fixedItems.filter(f => !f.fim || f.fim >= currentMonth()).map(f => f.desc).filter(Boolean)));
  const billCat = $('billCat');
  const cur = billCat.value;
  billCat.innerHTML = '';
  [...activeNames, 'Outros'].forEach(n => billCat.append(el('option', { value: n }, n)));
  if (activeNames.includes(cur) || cur === 'Outros') billCat.value = cur;

  // Cartão: categorias padrão + as que já existem nos lançamentos (ex.: digitadas na planilha)
  const usedCartao = state.expenses.filter(e => e.ciclo === 'cartao').map(e => e.cat).filter(Boolean);
  const extras = Array.from(new Set(usedCartao)).filter(c => !CARTAO_CATS.includes(c)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const expCat = $('expCat');
  const curE = expCat.value;
  const labels = { Transporte: 'Transporte / Combustível', Moradia: 'Moradia / Contas', Lazer: 'Lazer / Restaurante' };
  expCat.innerHTML = '';
  [...CARTAO_CATS.filter(c => c !== 'Outros'), ...extras, 'Outros'].forEach(n => expCat.append(el('option', { value: n }, labels[n] || n)));
  if ([...expCat.options].some(o => o.value === curE)) expCat.value = curE;

  const hist = $('histCatFilter');
  const curH = hist.value;
  hist.innerHTML = '<option value="">Todas</option>';
  const allUsed = state.expenses.map(e => e.cat).filter(Boolean);
  Array.from(new Set([...CARTAO_CATS, ...names, ...allUsed])).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .forEach(n => hist.append(el('option', { value: n }, n)));
  hist.value = curH;
}

/* ─── Ordenação / duplicatas (decisões do projeto original) ─── */
function sortExpensesByDate(list) {
  return list.map((item, idx) => ({ item, idx }))
    .sort((a, b) => b.item.date.localeCompare(a.item.date) || a.idx - b.idx)
    .map(x => x.item);
}
function flagPossibleDuplicates(list) {
  const seen = new Map();
  list.forEach(it => {
    const k = `${it.date}|${(Number(it.value) || 0).toFixed(2)}|${String(it.desc || '').trim().toLowerCase()}`;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(it.id);
  });
  const dup = new Set();
  seen.forEach(g => { if (g.length > 1) g.forEach(id => dup.add(id)); });
  return dup;
}

/* ─── Linha de despesa (Cartão / Contas / Histórico) ─── */
function createExpenseRow(item, { onEdit, isDuplicate = false, showCiclo = false } = {}) {
  const origem = item.origem || '';
  const isFuel = origem.startsWith('abastecimento:');
  const isMaint = origem.startsWith('manutencao:');
  const cls = ['item'];
  const pend = isPending('exp:' + item.id);
  if (pend) cls.push('pending');
  if (item.fixedId) cls.push('fixed');
  if (isFuel || isMaint) cls.push('fuel-link');
  if (isDuplicate) cls.push('dup');

  const sub = el('div', { class: 'item-sub' },
    el('span', { class: 'tag' }, item.cat),
    el('span', {}, fmtDM(item.date)));
  if (showCiclo || item.ciclo === 'contas') {
    if (item.ciclo === 'contas') sub.append(el('span', { class: 'tag contas' }, item.fixedId ? '🔁 fixa' : '🧾 contas'));
    else if (showCiclo) sub.append(el('span', { class: 'tag' }, '💳 cartão'));
  }
  if (isFuel) sub.append(el('span', { class: 'tag veiculo' }, '⛽ abastecimento'));
  if (isMaint) sub.append(el('span', { class: 'tag veiculo' }, '🔧 manutenção'));
  const pi = parcelaInfo(item);
  if (pi) sub.append(el('span', { class: 'tag' }, `🧩 ${pi.n}/${pi.total}`));
  if (pend) sub.append(el('span', { class: 'tag warn' }, '⏳ a enviar'));
  if (isDuplicate) sub.append(el('span', { class: 'tag danger' }, '🔁 possível duplicata'));

  return el('div', { class: cls.join(' ') },
    el('div', { class: 'item-info' }, el('span', { class: 'item-title' }, item.desc), sub),
    el('div', { class: 'item-right' },
      el('span', { class: 'item-val' }, formatBRL(item.value)),
      el('button', { class: 'icon-btn', title: 'Editar', 'aria-label': 'Editar ' + item.desc, onclick: () => (onEdit || startEditByCiclo)(item.id) }, '✏️'),
      el('button', { class: 'icon-btn', title: 'Excluir', 'aria-label': 'Excluir ' + item.desc, onclick: () => confirmDeleteExpense(item.id) }, '🗑️')
    ));
}
const startEditByCiclo = id => {
  const it = state.expenses.find(e => e.id === String(id));
  if (it && it.ciclo === 'contas') startEditBillExpense(id); else startEditExpense(id);
};

function fillList(container, items, emptyText, rowOpts = {}) {
  container.innerHTML = '';
  if (!items.length) { container.append(el('div', { class: 'empty' }, emptyText)); return; }
  const dup = rowOpts.flagDup ? flagPossibleDuplicates(items) : new Set();
  sortExpensesByDate(items).forEach(it => container.append(createExpenseRow(it, { ...rowOpts, isDuplicate: dup.has(it.id) })));
}

export { activeFixasFor, addMonths, addMonthsDate, createExpenseRow, currentMonth, dateInComp, expenseCompetencia, fillList, flagPossibleDuplicates, isFixaActive, matchesCardInvoice, parcelaInfo, populateCategories, sortExpensesByDate, startEditByCiclo, sumValues };
