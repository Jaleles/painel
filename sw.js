// Service worker do Painel Pessoal: abre sem internet e busca a versão nova quando há conexão.
// Ao publicar uma versão nova do app, aumente o número abaixo.
const VERSAO = 'painel-v4-2';
const ARQUIVOS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  // módulos do app (o teste tests/publicacao.test.mjs avisa se faltar algum)
  './js/ajustes.js', './js/app.js', './js/estado.js',
  './js/gastos/cartao.js', './js/gastos/comum.js', './js/gastos/contas.js',
  './js/gastos/exclusao.js', './js/gastos/fixas.js', './js/gastos/historico.js',
  './js/gastos/parcelas.js', './js/gastos/teto.js', './js/graficos.js',
  './js/main.js', './js/modal.js', './js/sync.js',
  './js/util.js', './js/veiculo/abastecer.js', './js/veiculo/calculos.js',
  './js/veiculo/historico.js', './js/veiculo/manutencao.js', './js/veiculo/painel.js',
  './js/veiculo/tela.js', './js/veiculo/vinculo.js'
];

// Instala buscando tudo do servidor (cache: 'reload'), para não guardar uma cópia antiga que o
// navegador já tinha, e assume o controle sem esperar: página e código sempre da mesma versão.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO)
    .then(c => c.addAll(ARQUIVOS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Rede primeiro para TUDO do app (conferindo com o servidor), cache só sem internet.
// Antes os módulos vinham do cache primeiro: depois de publicar, a página nova rodava com código velho.
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // planilha (Apps Script) nunca passa pelo cache
  const navigate = req.mode === 'navigate';
  const key = navigate ? './index.html' : req;
  e.respondWith(fetch(navigate ? req : new Request(req, { cache: 'no-cache' })).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSAO).then(c => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key, { ignoreSearch: true })));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
