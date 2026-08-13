// Service worker do MY TRAKR.
//
// DELIBERADAMENTE CONSERVADOR: ele NÃO guarda página nem resposta de API.
//
// Um painel de treino mostrando dado velho como se fosse de agora é pior do que
// não abrir. O atleta veria a semana da semana passada, o gráfico de carga sem
// os últimos treinos, ou um farol de prontidão de anteontem — e não teria como
// saber. Cache de HTML aqui compraria "abre offline" ao preço de "mente às
// vezes", que é um péssimo negócio para uma ferramenta em que a pessoa confia
// para decidir se treina forte hoje.
//
// O que ele faz: guarda os arquivos estáticos (JS, CSS, fontes, imagens), que
// são versionados pelo build e portanto nunca ficam errados — só desatualizados,
// e um deploy novo troca a URL deles. Isso já dá a partida rápida e satisfaz o
// requisito de instalabilidade do Android.
const CACHE = "trakr-static-v1";

// Só o que o build versiona pelo nome. Nada de HTML, nada de /api.
const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  /\.(?:png|jpg|jpeg|svg|webp|avif|woff2?|ico)$/.test(url.pathname);

self.addEventListener("install", () => {
  // Sem pré-cache: a lista de arquivos muda a cada build, e uma lista fixa
  // envelheceria em silêncio. O que for pedido é guardado no caminho.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Outro domínio, ou qualquer coisa que não seja estático versionado: deixa
  // passar direto para a rede. Sem interceptar, sem guardar.
  if (url.origin !== self.location.origin || !isStatic(url)) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          // Resposta parcial ou de erro não entra no cache — guardaria um
          // arquivo quebrado que sobreviveria ao problema que o causou.
          if (res.ok && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
