"use client";

import { useActionState } from "react";
import { acaoEntrar, type EstadoLogin } from "@/app/actions/auth";

export default function FormLogin() {
  const [estado, acao, pendente] = useActionState<EstadoLogin, FormData>(acaoEntrar, undefined);

  return (
    <form action={acao} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="voce@banhodeencanto.com.br"
          defaultValue=""
          required
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="senha">Senha</label>
        <input id="senha" name="senha" type="password" autoComplete="current-password" placeholder="••••••••" required />
      </div>

      {estado?.erro ? (
        <div
          className="tag tag-vermelho aparecer"
          style={{ display: "block", padding: "9px 12px", borderRadius: 9, fontSize: 13 }}
        >
          {estado.erro}
        </div>
      ) : null}

      <button
        type="submit"
        className="btn btn-ouro btn-lg"
        disabled={pendente}
        style={{ marginTop: 4, width: "100%" }}
      >
        {pendente ? "Entrando..." : "Entrar no sistema"}
      </button>
    </form>
  );
}
