// Checagens de publicação: o app só funciona offline se o sw.js guardar todos os arquivos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');
const html = readFileSync(new URL('index.html', root), 'utf8');

test('sw.js guarda para uso offline todos os módulos e o CSS', () => {
  const js = readdirSync(new URL('js/', root), { recursive: true })
    .filter(f => f.endsWith('.js'))
    .map(f => './js/' + f.replace(/\\/g, '/'));
  const faltando = [...js, './styles.css'].filter(f => !sw.includes(`'${f}'`));
  assert.deepEqual(faltando, [], 'adicione ao ARQUIVOS do sw.js (e aumente a VERSAO)');
});

test('sw.js não lista arquivos que não existem mais', () => {
  const listados = [...sw.matchAll(/'\.\/(js\/[^']+)'/g)].map(m => m[1]);
  const existentes = new Set(readdirSync(new URL('js/', root), { recursive: true }).map(f => 'js/' + f.replace(/\\/g, '/')));
  assert.deepEqual(listados.filter(f => !existentes.has(f)), []);
});

test('index.html carrega o app como módulo e o CSS externo', () => {
  assert.match(html, /<script type="module" src="js\/main\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="styles\.css">/);
  assert.doesNotMatch(html, /<script>[\s\S]*<\/script>/, 'não deve haver script embutido');
});

test('sw.js busca na rede primeiro e instala sem reaproveitar cópia velha do navegador', () => {
  // Cache primeiro para os módulos fez a página nova rodar com código antigo (botão de conserto sem efeito)
  assert.doesNotMatch(sw, /caches\.match\(req\)\.then\(hit => hit \|\|/);
  assert.match(sw, /cache: 'reload'/);
  assert.match(sw, /cache: 'no-cache'/);
});
