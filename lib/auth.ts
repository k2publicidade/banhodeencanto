import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { one, run, auditar } from "./db";

const COOKIE = "bde_sessao";
const DURACAO_H = 12;

export type Papel = "admin" | "gerente" | "operador" | "vendedor";

export type UsuarioSessao = {
  id: number;
  nome: string;
  apelido: string | null;
  email: string | null;
  papel: Papel;
  loja_id: number | null;
  comissao_pct: number;
};

/* ------------------------------------------------------------------ */
/* Senhas                                                             */
/* ------------------------------------------------------------------ */

export function hashSenha(senha: string): string {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(senha, salt, 64).toString("hex");
}

export function verificarSenha(senha: string, hash: string | null): boolean {
  if (!hash || !hash.includes(":")) return false;
  const [salt, alvo] = hash.split(":");
  const calc = scryptSync(senha, salt, 64);
  const alvoBuf = Buffer.from(alvo, "hex");
  if (alvoBuf.length !== calc.length) return false;
  return timingSafeEqual(calc, alvoBuf);
}

/* ------------------------------------------------------------------ */
/* Chave de assinatura (gerada localmente na primeira execucao)        */
/* ------------------------------------------------------------------ */

function segredo(): string {
  if (process.env.BDE_SECRET) return process.env.BDE_SECRET;
  const dir = join(process.cwd(), "data");
  const arq = join(dir, ".secret");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(arq)) return readFileSync(arq, "utf8").trim();
  const s = randomBytes(48).toString("hex");
  writeFileSync(arq, s, { mode: 0o600 });
  return s;
}

function assinar(payload: string): string {
  return createHmac("sha256", segredo()).update(payload).digest("base64url");
}

/* ------------------------------------------------------------------ */
/* Sessao                                                             */
/* ------------------------------------------------------------------ */

export async function entrar(email: string, senha: string): Promise<{ ok: boolean; erro?: string }> {
  const u = one<any>(
    `SELECT id, nome, apelido, email, senha_hash, papel, loja_id, comissao_pct, ativo
     FROM usuarios WHERE lower(email) = lower(?)`,
    email.trim()
  );
  if (!u) return { ok: false, erro: "E-mail nao encontrado." };
  if (!u.ativo) return { ok: false, erro: "Usuario inativo." };
  if (!verificarSenha(senha, u.senha_hash)) return { ok: false, erro: "Senha incorreta." };

  const corpo = Buffer.from(
    JSON.stringify({ uid: u.id, exp: Date.now() + DURACAO_H * 3600 * 1000 })
  ).toString("base64url");
  const token = corpo + "." + assinar(corpo);

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_H * 3600,
  });

  run("UPDATE usuarios SET ultimo_acesso = datetime('now','localtime') WHERE id = ?", u.id);
  auditar({ usuario_id: u.id, usuario_nome: u.nome, acao: "login", entidade: "usuarios", entidade_id: u.id });
  return { ok: true };
}

export async function sair() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Usuario logado, ou null. */
export async function sessao(): Promise<UsuarioSessao | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token || !token.includes(".")) return null;
  const [corpo, assinatura] = token.split(".");
  if (assinar(corpo) !== assinatura) return null;
  let dados: { uid: number; exp: number };
  try {
    dados = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!dados.exp || dados.exp < Date.now()) return null;
  const u = one<UsuarioSessao>(
    `SELECT id, nome, apelido, email, papel, loja_id, comissao_pct FROM usuarios WHERE id = ? AND ativo = 1`,
    dados.uid
  );
  return u ?? null;
}

/** Exige login; redireciona para /login se nao houver sessao. */
export async function exigir(): Promise<UsuarioSessao> {
  const u = await sessao();
  if (!u) redirect("/login");
  return u;
}

/** Exige papel de gestao (admin/gerente). */
export async function exigirGestao(): Promise<UsuarioSessao> {
  const u = await exigir();
  if (u.papel !== "admin" && u.papel !== "gerente") redirect("/caixa");
  return u;
}

export function podeGerenciar(u: UsuarioSessao | null): boolean {
  return !!u && (u.papel === "admin" || u.papel === "gerente");
}
