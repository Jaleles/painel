// Importa os módulos do app (js/) num "navegador" mínimo para testar as regras sem abrir a página.
// Os módulos são carregados uma vez por arquivo de teste; load() zera o estado e fixa a data de "hoje".
process.env.TZ = 'America/Sao_Paulo';

import { readdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';

class Node {}
function fakeElement() {
  const target = Object.assign(new Node(), {
    textContent: '', innerHTML: '', value: '', checked: false, className: '',
    style: { setProperty() {} }, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    append(...c) { target.children.push(...c); },
    appendChild(c) { target.children.push(c); return c; },
    setAttribute() {}, addEventListener() {}, focus() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => []
  });
  return target;
}

let fixedNow = Date.now();
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixedNow])); }
  static now() { return fixedNow; }
}

const elements = new Map();
const memory = new Map();
Object.assign(globalThis, {
  Node,
  Date: FakeDate,
  setTimeout: () => 0, clearTimeout() {},   // nada roda "depois": testes determinísticos
  localStorage: {
    getItem: k => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: k => memory.delete(k)
  },
  location: { protocol: 'file:' },
  document: {
    getElementById: id => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); },
    createElement: () => fakeElement(),
    createTextNode: t => String(t),
    querySelectorAll: () => [],
    addEventListener() {},
    documentElement: fakeElement()
  },
  fetch: () => Promise.reject(new TypeError('sem rede nos testes'))
});
globalThis.window = globalThis;

// Todos os módulos de js/ (menos main.js, que inicializa a página) num único "espaço de nomes"
const jsDir = fileURLToPath(new URL('../js/', import.meta.url));
const files = readdirSync(jsDir, { recursive: true }).filter(f => f.endsWith('.js') && f !== 'main.js');
const modules = await Promise.all(files.map(f => import(pathToFileURL(join(jsDir, f)).href)));
const api = Object.assign({}, ...modules.map(m => ({ ...m })));
const estado = modules.find(m => 'setState' in m);

export function load({ today = '2026-09-15T12:00:00' } = {}) {
  fixedNow = new RealDate(today).getTime();
  elements.clear();
  estado.setState(estado.makeDefaultState());
  estado.ui.view = '';            // nenhuma tela ativa: commit() não redesenha nada
  return {
    /** Função ou valor exportado pelo app, pelo nome (ex.: app.fn('calcFuels')) */
    fn: name => { if (!(name in api)) throw new Error(`"${name}" não é exportado por nenhum módulo`); return api[name]; },
    get state() { return estado.state; },
    /** Substitui o estado (campos ausentes vêm do estado padrão) */
    setState(partial) { estado.setState({ ...estado.makeDefaultState(), ...partial }); return estado.state; },
    /** Texto de um elemento da página, como o usuário veria */
    text: id => {
      const n = document.getElementById(id);
      return String(n.textContent || n.innerHTML.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')).replace(/ /g, ' ');
    }
  };
}

/** Cópia simples, para comparar com deepStrictEqual */
export const plain = x => JSON.parse(JSON.stringify(x));
