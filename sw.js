// Service worker do Painel Pessoal: abre sem internet e busca a versão nova quando há conexão.
// Ao publicar uma versão nova do app, aumente o número abaixo.
const VERSAO = 'painel-v4-0';
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

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // planilha (Apps Script) nunca passa pelo cache
  if (req.mode === 'navigate') {
    // página: tenta a rede primeiro (pega atualizações), cai no cache se estiver offline
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSAO).then(c => c.put('./index.html', copy));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
