import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Banho de Encanto - Sistema de Gestao",
  description:
    "Sistema de gestao, estoque e PDV da Banho de Encanto - Cabelos Sinteticos",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#00303c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
