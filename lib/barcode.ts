/* ------------------------------------------------------------------ */
/* Codigo de barras EAN-13: validacao, verificacao e geracao           */
/* ------------------------------------------------------------------ */

/** Digito verificador do EAN-13 (pesos 1,3 alternados) */
export function digitoEAN13(doze: string): string {
  const d = doze.replace(/\D/g, "").padStart(12, "0").slice(0, 12);
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  const resto = soma % 10;
  return String(resto === 0 ? 0 : 10 - resto);
}

export function ean13Valido(codigo: string | null | undefined): boolean {
  if (!codigo) return false;
  const c = String(codigo).replace(/\D/g, "");
  if (c.length !== 13) return false;
  return digitoEAN13(c.slice(0, 12)) === c[12];
}

export function geraEAN13(base12: string): string {
  const b = base12.replace(/\D/g, "").padStart(12, "0").slice(0, 12);
  return b + digitoEAN13(b);
}

/**
 * Gera um EAN-13 interno com prefixo 200-299 (faixa de uso interno/restrito),
 * evitando colisao com EANs de fabricante.
 */
export function ean13Interno(sequencial: number): string {
  const base = "200" + String(sequencial).padStart(9, "0");
  return geraEAN13(base);
}

/** Codigo interno legivel: COD-000123 */
export function codigoInterno(id: number): string {
  return "COD-" + String(id).padStart(6, "0");
}

/* ------------------------------------------------------------------ */
/* Desenho das barras (para etiqueta / cupom)                          */
/* ------------------------------------------------------------------ */

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARIDADE = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** Retorna o padrao de bits do EAN-13 (95 modulos) para desenhar */
export function barrasEAN13(codigo: string): string {
  const c = codigo.replace(/\D/g, "").padStart(13, "0").slice(0, 13);
  const p = PARIDADE[Number(c[0])];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (p[i - 1] === "L" ? L : G)[Number(c[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[Number(c[i])];
  bits += "101";
  return bits;
}
