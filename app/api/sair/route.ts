import { sair } from "@/lib/auth";

export async function POST() {
  await sair();
  return Response.redirect(new URL("/login", process.env.BDE_URL || "http://localhost:3000"), 303);
}
