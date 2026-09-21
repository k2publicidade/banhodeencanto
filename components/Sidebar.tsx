"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MENU, itemAtivo } from "./menu";

/** Barra lateral do desktop (no celular quem manda e o NavegacaoMobile). */
export default function Sidebar({ nome, apelido, papel }: { nome: string; apelido: string | null; papel: string }) {
  const caminho = usePathname();

  return (
    <aside className="sidebar nao-imprimir">
      <Link href="/painel" style={{ display: "block", marginBottom: 6, padding: "0 6px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-md.webp"
          alt="Banho de Encanto"
          width={190}
          height={92}
          style={{ width: "100%", maxWidth: 190, height: "auto" }}
        />
      </Link>

      <nav style={{ flex: 1, marginTop: 8 }}>
        {MENU.map((g) => (
          <div key={g.titulo}>
            <div className="titulo-secao">{g.titulo}</div>
            {g.itens.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={"sidebar-item" + (itemAtivo(caminho, it.href) ? " ativo" : "")}
              >
                <span style={{ width: 16, textAlign: "center", opacity: 0.9 }}>{it.icone}</span>
                <span>{it.rotulo}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,0.12)",
          padding: "12px 8px 2px",
          marginTop: 10,
        }}
      >
        <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{apelido || nome}</div>
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11.5, textTransform: "capitalize" }}>{papel}</div>
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
