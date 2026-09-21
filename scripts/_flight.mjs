/**
 * Leitura do retorno de uma server action do Next em formato flight (RSC).
 *
 * Formato da resposta:
 *   0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}
 *   1:D"$2"          <- referencia para outra linha
 *   1:{"ok":true}    <- valor real (a linha pode aparecer mais de uma vez)
 *
 * Quando a action chama revalidatePath, a MESMA resposta tambem carrega o
 * re-render da pagina (varias linhas, inclusive a arvore da pagina). Por isso
 * ler "a ultima linha que for JSON" devolve a pagina, nao o resultado: e
 * preciso seguir a referencia "$@1" da linha 0 e usar a ultima ocorrencia
 * daquela linha.
 */

function linhasDaResposta(txt) {
  const linhas = new Map(); // id -> ultima ocorrencia do id na resposta
  for (const l of txt.split("\n")) {
    const m = l.match(/^([0-9a-f]+):(.*)$/s);
    if (m) linhas.set(m[1], m[2]);
  }
  return linhas;
}

const RE_REFERENCIA = /^D\{?\s*\$?([0-9a-f]+)/;

export function decodificarFlight(txt) {
  const linhas = linhasDaResposta(txt);
  if (!linhas.has("0")) return undefined;

  // A linha 0 aponta ("a") para a linha que tem o retorno da action.
  let alvo = "0";
  try {
    const meta = JSON.parse(linhas.get("0"));
    const a = meta && typeof meta.a === "string" ? meta.a : "";
    const m = a.match(/^\$@([0-9a-f]+)$/);
    if (m) alvo = m[1];
  } catch {
    /* linha 0 nao e um objeto simples: segue com a propria linha 0 */
  }

  // Segue cadeias de referencia (D"$3" -> linha 3) antes de decodificar.
  for (let salto = 0; salto < 8; salto++) {
    const payload = linhas.get(alvo);
    if (payload === undefined) return undefined;
    const ref = payload.match(RE_REFERENCIA);
    if (!ref) {
      if (payload === "null") return null;
      try {
        return JSON.parse(payload);
      } catch {
        return undefined;
      }
    }
    alvo = ref[1];
  }
  return undefined;
}
