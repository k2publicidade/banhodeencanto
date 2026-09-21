import { redirect } from "next/navigation";
import { sessao } from "@/lib/auth";
import { one } from "@/lib/db";
import FormLogin from "./FormLogin";

export const dynamic = "force-dynamic";

export default async function PaginaLogin() {
  const u = await sessao();
  if (u) redirect("/painel");

  const loja = one<{ nome: string; apelido: string }>(
    "SELECT nome, apelido FROM lojas WHERE padrao = 1 LIMIT 1"
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)",
        background: "linear-gradient(160deg,#00303c 0%,#001a22 100%)",
      }}
    >
      {/* Lado da marca */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "48px 40px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 620,
            height: 620,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(200,145,58,0.13) 0%, transparent 68%)",
            pointerEvents: "none",
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-transparente.png"
          alt="Banho de Encanto - Cabelos Sinteticos"
          style={{ width: "min(560px, 88%)", height: "auto", position: "relative" }}
        />
        <p
          style={{
            marginTop: 26,
            color: "rgba(255,255,255,0.66)",
            fontSize: 14.5,
            textAlign: "center",
            maxWidth: 460,
            lineHeight: 1.65,
            position: "relative",
          }}
        >
          Sistema de gestao de estoque, cadastro de produtos e PDV.
          <br />
          Operacao de caixa na loja e administracao completa.
        </p>
      </div>

      {/* Lado do formulario */}
      <div
        style={{
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 34px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 372 }}>
          <div style={{ marginBottom: 26 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.13em",
                textTransform: "uppercase",
                color: "#c8913a",
                marginBottom: 8,
              }}
            >
              Acesso restrito
            </div>
            <h1 style={{ fontSize: 27, margin: 0, color: "#00303c" }}>Entrar no sistema</h1>
            <p style={{ color: "#7d7466", fontSize: 13.5, marginTop: 8, marginBottom: 0 }}>
              {loja?.nome ?? "Banho de Encanto"}
            </p>
          </div>

          <FormLogin />

          <div
            style={{
              marginTop: 28,
              paddingTop: 20,
              borderTop: "1px solid #e7e1d6",
              fontSize: 12.5,
              color: "#7d7466",
              lineHeight: 1.85,
            }}
          >
            <strong style={{ color: "#3a352e", display: "block", marginBottom: 6 }}>
              Acessos de demonstracao
            </strong>
            <div>
              Administrador: <code>admin@banhodeencanto.com.br</code> / <code>encanto123</code>
            </div>
            <div>
              Operador de caixa: <code>caixa@banhodeencanto.com.br</code> / <code>encanto123</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
