/**
 * Gera os assets de interface a partir dos arquivos originais em public/.
 *
 * Roda com: node scripts/gerar-assets.mjs
 * Precisa do sharp (instalado sob demanda): npm i --no-save sharp
 *
 * Motivo: o logo original tem 951 KB e 1705 px de largura. Num celular isso e
 * caro e desnecessario, entao aqui saem versoes leves (webp) para o login, a
 * barra do app e o PDV, alem dos icones do app instalavel (PWA).
 */
import sharp from "sharp";
import { statSync } from "node:fs";
import { join } from "node:path";

const pub = join(process.cwd(), "public");
const kb = (p) => Math.round(statSync(p).size / 1024) + " KB";

async function gerar(entrada, saida, largura, formato, opcoes = {}) {
  const destino = join(pub, saida);
  const mesmaOrigem = join(pub, entrada) === destino;
  let p = sharp(join(pub, entrada)).resize({ width: largura, withoutEnlargement: true });
  if (formato === "webp") p = p.webp({ quality: 84, effort: 5 });
  else if (formato === "png") p = p.png({ compressionLevel: 9, palette: true, quality: 88 });
  else throw new Error("formato nao suportado: " + formato);
  if (mesmaOrigem) {
    // Sobrescrever o proprio arquivo: o sharp exige gerar em memoria primeiro.
    const buf = await p.toBuffer();
    await sharp(buf).toFile(destino + ".tmp");
    await sharp(destino + ".tmp").toFile(destino);
    const { rmSync } = await import("node:fs");
    rmSync(destino + ".tmp", { force: true });
  } else {
    await p.toFile(destino);
  }
  console.log(`  ${saida.padEnd(28)} ${String(largura).padStart(4)}px  ${kb(destino)}`);
}

console.log("Logos leves:");
await gerar("logo-transparente.png", "logo-md.webp", 720, "webp");
await gerar("logo-transparente.png", "logo-sm.webp", 380, "webp");
await gerar("logo-mark.png", "logo-mark-sm.webp", 132, "webp");
await gerar("logo-mark.png", "logo-mark-sm.png", 132, "png");

console.log("Icones do app instalavel (PWA):");
await gerar("icon-512.png", "icon-192.png", 192, "png");
await gerar("icon-512.png", "icon-512.png", 512, "png");
await gerar("icon-512.png", "apple-touch-icon.png", 180, "png");
await gerar("icon-512.png", "favicon-32.png", 32, "png");
await gerar("icon-512.png", "favicon-16.png", 16, "png");

console.log("\nPronto. Os arquivos originais (logo.png, logo-transparente.png...) seguem intactos.");
