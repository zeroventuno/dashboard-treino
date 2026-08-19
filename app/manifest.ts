import type { MetadataRoute } from "next";

/**
 * O que torna o painel instalável como app no Android e no iOS.
 *
 * `start_url` aponta para /app e não para a raiz: quem instala isto na tela
 * inicial é atleta, e a raiz é a landing de vendas. Abrir o app e cair numa
 * página de preço é a primeira coisa que faria alguém desinstalar.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MY TRAKR",
    short_name: "TRAKR",
    description: "Seu treino, lido pela sua IA.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0b0d",
    theme_color: "#0a0b0d",
    categories: ["health", "fitness", "sports"],
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
      // `maskable` deixa o Android recortar no formato do sistema em vez de
      // desenhar o ícone dentro de um quadrado branco.
      { src: "/icon.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Hoje", url: "/app" },
    ],
    // Lets the OS "Share" sheet list MY TRAKR as a destination for a .fit
    // exported from another app (Garmin Connect, etc.) — Android/Chrome only
    // today, iOS Safari doesn't implement the receiving half of Web Share yet.
    // A share that lands here goes through the exact same route as the manual
    // upload form (components/ImportFile.tsx), so this is additive, never the
    // only way in.
    share_target: {
      action: "/api/app/import",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        files: [{ name: "file", accept: [".fit", "application/octet-stream", "application/vnd.ant.fit"] }],
      },
    },
  };
}
