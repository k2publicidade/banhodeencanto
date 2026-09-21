import type { MetadataRoute } from "next";

/**
 * Manifesto do app: permite "instalar" o sistema na tela do celular e abrir
 * em tela cheia, com a cara de aplicativo nativo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Banho de Encanto - Gestao e PDV",
    short_name: "Banho de Encanto",
    description: "Sistema de gestao, estoque e PDV da Banho de Encanto - Cabelos Sinteticos",
    start_url: "/caixa",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#faf8f4",
    theme_color: "#00303c",
    lang: "pt-BR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Abrir o PDV", url: "/caixa" },
      { name: "Painel", url: "/painel" },
      { name: "Vendas", url: "/vendas" },
    ],
  };
}
