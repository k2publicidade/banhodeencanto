import { redirect } from "next/navigation";
import { sessao } from "@/lib/auth";
import { one } from "@/lib/db";
import FormLogin from "./FormLogin";

export const dynamic = "force-dynamic";

export default async function PaginaLogin() {
  const u = await sessao();
  if (u) redirect("/painel");

  const loja = one<{ nome: string; apelido: string }>("SELECT nome, apelido FROM lojas WHERE padrao = 1 LIMIT 1");

  return (
    <div className="login">
      {/* Lado da marca */}
      <div className="login-marca">
        <div
          aria-hidden
          style={{
            position: "absolute",
            width: 620,
            height: 620,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(200,145,58,0.14) 0%, transparent 68%)",
            pointerEvents: "none",
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-md.webp"
          alt="Banho de Encanto - Cabelos Sinteticos"
          width={1705}
          height={826}
          style={{ width: "min(560px, 80%)", height: "auto", position: "relative" }}
        />
        <p className="login-frase">
          Sistema de gestao de estoque, cadastro de produtos e PDV.
          <br />
          Operacao de caixa na loja e administracao completa.
        </p>
      </div>

      {/* Lado do formulario */}
      <div className="login-form">
        <div style={{ width: "100%", maxWidth: 380 }}>
          <div style={{ marginBottom: 22 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.13em",
                textTransform: "uppercase",
                color: "var(--color-ouro-500)",
                marginBottom: 8,
              }}
            >
              Acesso restrito
            </div>
            <h1 style={{ fontSize: 25, margin: 0, color: "var(--color-encanto-800)", fontWeight: 400 }}>
              Entrar no sistema
            </h1>
            <p style={{ color: "var(--color-creme-600)", fontSize: 13.5, marginTop: 8, marginBottom: 0 }}>
              {loja?.nome ?? "Banho de Encanto"}
            </p>
          </div>

          <FormLogin />

          <details className="login-dica">
            <summary>Acessos de demonstracao</summary>
            <div>
              Administrador: <code>admin@banhodeencanto.com.br</code> / <code>encanto123</code>
            </div>
            <div>
              Operador de caixa: <code>caixa@banhodeencanto.com.br</code> / <code>encanto123</code>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
