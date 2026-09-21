import Link from "next/link";
import { notFound } from "next/navigation";
import { exigir } from "@/lib/auth";
import { all, one, config } from "@/lib/db";
import { moeda } from "@/lib/format";
import { barrasEAN13 } from "@/lib/barcode";

export const dynamic = "force-dynamic";

function CodigoBarras({ valor, altura = 42, largura = 1.55 }: { valor: string; altura?: number; largura?: number }) {
  const digitos = String(valor).replace(/\D/g, "").padStart(13, "0").slice(0, 13);
  const bits = barrasEAN13(digitos);
  const total = bits.length * largura;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ display: "flex", height: altura, alignItems: "flex-end", justifyContent: "center" }}>
        {bits.split("").map((b, i) => (
          <div key={i} style={{ width: largura, height: "100%", background: b === "1" ? "#000" : "transparent" }} />
        ))}
      </div>
      <div style={{ fontSize: 10, letterSpacing: 1.5, fontFamily: "monospace", marginTop: 1 }}>{digitos}</div>
      <div style={{ width: total }} />
    </div>
  );
}

export default async function PaginaEtiquetas({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ qtd?: string }>;
}) {
  await exigir();
  const { id } = await params;
  const sp = await searchParams;
  const produtoId = Number(id);
  const porEtiqueta = Math.max(1, Math.min(60, Number(sp.qtd) || 6));

  const p = one<any>("SELECT id, nome, nome_reduzido, sku FROM produtos WHERE id = ?", produtoId);
  if (!p) notFound();

  const variacoes = all<any>(
    `SELECT variacao_id, sku, ean, cor_codigo, cor, cor_hex, comprimento, comprimento_unidade, preco_venda, preco_promocional, unidade_estoque, disponivel
     FROM vw_estoque_posicao WHERE produto_id = ? AND variacao_status = 'ativo'
     ORDER BY cor_codigo, comprimento`,
    produtoId
  );

  const nomeLoja = config("empresa_nome", "Banho de Encanto");
  const slogan = config("empresa_slogan", "Cabelos Sinteticos");

  const etiquetas = variacoes.flatMap((v) => Array.from({ length: porEtiqueta }, () => v));

  return (
    <>
      <div className="nao-imprimir" style={{ background: "#fff", borderBottom: "1px solid #e7e1d6", padding: "16px 22px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, color: "#00303c" }}>Etiquetas com codigo de barras</h1>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: "#7d7466" }}>
            {p.nome} • {variacoes.length} SKU(s) • {etiquetas.length} etiqueta(s) • EAN-13 valido
          </p>
        </div>
        <div style={{ flex: 1 }} />
        <form method="get" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ width: 150 }}>
            <label htmlFor="qtd">Etiquetas por SKU</label>
            <input id="qtd" name="qtd" type="number" min={1} max={60} defaultValue={porEtiqueta} />
          </div>
          <button className="btn btn-neutro" type="submit">Atualizar</button>
        </form>
        <Link className="btn btn-neutro" href={`/produtos/${produtoId}?aba=variacoes`}>Voltar</Link>
      </div>

      <div style={{ padding: 22 }}>
        {variacoes.length === 0 ? (
          <div className="card" style={{ padding: 30, textAlign: "center", color: "#7d7466" }}>
            Este produto nao tem SKUs ativos para gerar etiquetas.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))", gap: 8 }}>
            {etiquetas.map((v, i) => (
              <div
                key={i}
                style={{
                  border: "1px dashed #d5ccba",
                  borderRadius: 6,
                  padding: "7px 9px",
                  background: "#fff",
                  breakInside: "avoid",
                }}
              >
                <div style={{ textAlign: "center", borderBottom: "1px solid #f2eee2", paddingBottom: 4 }}>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 12, color: "#00303c", lineHeight: 1.2 }}>{nomeLoja}</div>
                  <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "#7d7466" }}>{slogan.toUpperCase()}</div>
                </div>
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, lineHeight: 1.25 }}>
                    {p.nome_reduzido || p.nome}
                  </div>
                  <div style={{ fontSize: 10.5, color: "#7d7466" }}>
                    {v.cor_codigo ? `Cor ${v.cor_codigo}` : ""} {v.comprimento ? `• ${v.comprimento}${v.comprimento_unidade}` : ""}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 2 }}>
                    <span style={{ fontSize: 9, color: "#7d7466" }}>{v.unidade_estoque}</span>
                    <span style={{ fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700 }}>
                      {moeda(v.preco_promocional && v.preco_promocional < v.preco_venda ? v.preco_promocional : v.preco_venda)}
                    </span>
                  </div>
                  <div style={{ marginTop: 3 }}>
                    <CodigoBarras valor={v.ean || "0000000000000"} altura={38} />
                  </div>
                  <div style={{ fontSize: 8.5, color: "#7d7466", textAlign: "center", marginTop: 2 }}>
                    {v.sku} • estoque {v.disponivel}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
