"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; rotulo: string; icone: string };

const GRUPOS: { titulo: string; itens: Item[] }[] = [
  {
    titulo: "Operacao",
    itens: [
      { href: "/caixa", rotulo: "PDV / Caixa", icone: "▣" },
      { href: "/painel", rotulo: "Painel", icone: "◈" },
      { href: "/vendas", rotulo: "Vendas", icone: "≡" },
    ],
  },
  {
    titulo: "Catalogo",
    itens: [
      { href: "/produtos", rotulo: "Produtos e SKUs", icone: "❖" },
      { href: "/estoque", rotulo: "Estoque", icone: "▤" },
      { href: "/compras", rotulo: "Compras", icone: "▽" },
      { href: "/fornecedores", rotulo: "Fornecedores", icone: "◇" },
    ],
  },
  {
    titulo: "Gestao",
    itens: [
      { href: "/clientes", rotulo: "Clientes e Fiado", icone: "☺" },
      { href: "/relatorios", rotulo: "Relatorios", icone: "▨" },
      { href: "/cadastros", rotulo: "Cadastros auxiliares", icone: "⚙" },
      { href: "/configuracoes", rotulo: "Configuracoes", icone: "✦" },
    ],
  },
];

export default function Sidebar({ nome, apelido, papel }: { nome: string; apelido: string | null; papel: string }) {
  const caminho = usePathname();

  return (
    <aside
      className="sidebar nao-imprimir"
      style={{
        width: 232,
        minWidth: 232,
        height: "100vh",
        position: "sticky",
        top: 0,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        padding: "16px 12px",
      }}
    >
      <Link href="/painel" style={{ display: "block", marginBottom: 6, padding: "0 6px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-transparente.png"
          alt="Banho de Encanto"
          style={{ width: "100%", maxWidth: 190, height: "auto" }}
        />
      </Link>

      <nav style={{ flex: 1, marginTop: 8 }}>
        {GRUPOS.map((g) => (
          <div key={g.titulo}>
            <div className="titulo-secao">{g.titulo}</div>
            {g.itens.map((it) => {
              const ativo = caminho === it.href || caminho.startsWith(it.href + "/");
              return (
                <Link key={it.href} href={it.href} className={"sidebar-item" + (ativo ? " ativo" : "")}>
                  <span style={{ width: 16, textAlign: "center", opacity: 0.9 }}>{it.icone}</span>
                  <span>{it.rotulo}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,0.12)",
          paddingTop: 12,
          marginTop: 10,
          padding: "12px 8px 2px",
        }}
      >
        <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{apelido || nome}</div>
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11.5, textTransform: "capitalize" }}>
          {papel}
        </div>
        <form action="/api/sair" method="post">
          <button
            type="submit"
            className="btn btn-sm"
            style={{
              marginTop: 10,
              background: "rgba(255,255,255,0.09)",
              color: "#fff",
              width: "100%",
              border: "1px solid rgba(255,255,255,0.15)",
            }}
          >
            Sair
          </button>
        </form>
      </div>
    </aside>
  );
}
