"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MENU, MENU_RODAPE, itemAtivo, tituloDaRota } from "./menu";

/**
 * Navegacao do celular, no estilo de app nativo:
 *  - barra de topo fixa (menu, titulo da tela, acesso rapido ao PDV)
 *  - gaveta lateral com o sistema inteiro
 *  - barra de abas fixa no rodape, com area segura para o gesto do sistema
 *
 * A barra lateral do desktop continua sendo o componente Sidebar.
 */
export default function NavegacaoMobile({
  usuario,
  caixaAberto,
}: {
  usuario: { nome: string; papel: string };
  caixaAberto: boolean;
}) {
  const caminho = usePathname();
  const [gaveta, setGaveta] = useState(false);

  // Fecha a gaveta ao trocar de tela
  useEffect(() => {
    setGaveta(false);
  }, [caminho]);

  // Trava a rolagem do fundo enquanto a gaveta esta aberta
  useEffect(() => {
    document.body.classList.toggle("travado", gaveta);
    return () => document.body.classList.remove("travado");
  }, [gaveta]);

  useEffect(() => {
    if (!gaveta) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setGaveta(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [gaveta]);

  const titulo = tituloDaRota(caminho);

  return (
    <>
      <header className="app-topo so-no-mobile nao-imprimir">
        <div className="app-topo-linha">
          <button
            className="btn btn-icone"
            aria-label="Abrir menu"
            aria-expanded={gaveta}
            onClick={() => setGaveta(true)}
          >
            ☰
          </button>

          <div className="app-topo-titulo">
            <strong>{titulo}</strong>
            <span>
              {usuario.nome} · {usuario.papel}
              {caixaAberto ? " · caixa aberto" : " · caixa fechado"}
            </span>
          </div>

          <Link href="/caixa" className="btn btn-icone" aria-label="Abrir o PDV" style={{ fontSize: 18 }}>
            ▣
          </Link>
        </div>
      </header>

      {gaveta ? (
        <>
          <div className="gaveta-fundo so-no-mobile" onClick={() => setGaveta(false)} aria-hidden />
          <nav className="gaveta so-no-mobile" aria-label="Menu do sistema">
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 4px 10px" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark-sm.webp" alt="" style={{ height: 44, width: "auto" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#fff", fontFamily: "Georgia, serif", fontSize: 16 }}>Banho de Encanto</div>
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 11.5 }}>Sistema de gestao e PDV</div>
              </div>
              <button
                className="btn btn-icone"
                aria-label="Fechar menu"
                style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.16)", color: "#fff" }}
                onClick={() => setGaveta(false)}
              >
                ×
              </button>
            </div>

            {MENU.map((g) => (
              <div key={g.titulo}>
                <div className="gaveta-titulo">{g.titulo}</div>
                {g.itens.map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={"gaveta-item" + (itemAtivo(caminho, it.href) ? " ativo" : "")}
                  >
                    <span className="ico">{it.icone}</span>
                    <span>{it.rotulo}</span>
                  </Link>
                ))}
              </div>
            ))}

            <div
              style={{
                marginTop: "auto",
                paddingTop: 16,
                borderTop: "1px solid rgba(255,255,255,0.12)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{usuario.nome}</div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11.5, textTransform: "capitalize" }}>
                  {usuario.papel}
                </div>
              </div>
              <form action="/api/sair" method="post">
                <button
                  type="submit"
                  className="btn btn-sm"
                  style={{
                    background: "rgba(255,255,255,0.1)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.18)",
                  }}
                >
                  Sair
                </button>
              </form>
            </div>
          </nav>
        </>
      ) : null}

      <nav className="app-rodape so-no-mobile nao-imprimir" aria-label="Atalhos">
        {MENU_RODAPE.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={
              "rodape-item" + (itemAtivo(caminho, it.href) ? " ativo" : "") + (it.href === "/caixa" ? " rodape-caixa" : "")
            }
          >
            <span className="ico">{it.icone}</span>
            <span>{it.curto ?? it.rotulo}</span>
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setGaveta(true)}
          className="rodape-item"
          style={{ background: "none", border: "none" }}
          aria-label="Mais opcoes"
        >
          <span className="ico">⋯</span>
          <span>Mais</span>
        </button>
      </nav>
    </>
  );
}
