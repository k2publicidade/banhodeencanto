"use server";

import { redirect } from "next/navigation";
import { entrar, sair } from "@/lib/auth";

export type EstadoLogin = { erro?: string } | undefined;

export async function acaoEntrar(_prev: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get("email") || "");
  const senha = String(form.get("senha") || "");
  if (!email || !senha) return { erro: "Informe e-mail e senha." };

  const r = await entrar(email, senha);
  if (!r.ok) return { erro: r.erro || "Nao foi possivel entrar." };
  redirect("/painel");
}

export async function acaoSair() {
  await sair();
  redirect("/login");
}
