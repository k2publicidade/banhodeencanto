/* ------------------------------------------------------------------ */
/* Formatacao e calculos comerciais                                    */
/* ------------------------------------------------------------------ */

export const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function moeda(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "R$ 0,00";
  return BRL.format(Number(v));
}

/** "1.234,56" | "1234.56" | "R$ 12,90" -> 12.9 */
export function parseMoeda(s: string | number | null | undefined): number {
  if (s === null || s === undefined) return 0;
  if (typeof s === "number") return Number.isFinite(s) ? s : 0;
  const limpo = String(s)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? n : 0;
}

export function pct(v: number | null | undefined, dec = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Number(v).toFixed(dec).replace(".", ",") + "%";
}

export function num(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "0";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function arred(x: number, casas = 2): number {
  const f = Math.pow(10, casas);
  return Math.round((Number(x) + Number.EPSILON) * f) / f;
}

/* ------------------------------------------------------------------ */
/* Calculos (nunca digitados - o sistema sempre recalcula)             */
/* ------------------------------------------------------------------ */

export function margemValor(preco: number, custo: number): number {
  return arred(preco - custo);
}

export function margemPercentual(preco: number, custo: number): number | null {
  if (!preco || preco <= 0) return null;
  return arred(((preco - custo) / preco) * 100, 2);
}

export function markup(preco: number, custo: number): number | null {
  if (!custo || custo <= 0) return null;
  return arred(preco / custo, 3);
}

/** Preco sugerido a partir do custo e da margem desejada (%) */
export function precoPorMargem(custo: number, margemDesejadaPct: number): number {
  const m = Math.min(Math.max(margemDesejadaPct, 0), 99.9) / 100;
  return arred(custo / (1 - m));
}

/** Preco sugerido a partir do custo e do markup (multiplicador) */
export function precoPorMarkup(custo: number, multiplicador: number): number {
  return arred(custo * multiplicador);
}

/* ------------------------------------------------------------------ */
/* Datas                                                               */
/* ------------------------------------------------------------------ */

export function dataBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(String(iso).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10).split("-").reverse().join("/");
  return d.toLocaleDateString("pt-BR");
}

export function dataHoraBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(String(iso).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function agora(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/* ------------------------------------------------------------------ */
/* Texto                                                               */
/* ------------------------------------------------------------------ */

export function slugify(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

/** Compara ignorando acento e caixa - usado na busca do PDV */
export function normaliza(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
