import Link from "next/link";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Estrutura de pagina                                                 */
/* ------------------------------------------------------------------ */

export function Cabecalho({
  titulo,
  subtitulo,
  acoes,
}: {
  titulo: string;
  subtitulo?: string;
  acoes?: ReactNode;
}) {
  return (
    <div
      className="nao-imprimir"
      style={{
        background: "#fff",
        borderBottom: "1px solid #e7e1d6",
        padding: "16px 22px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 21, color: "#00303c" }}>{titulo}</h1>
        {subtitulo ? <p style={{ margin: "3px 0 0", fontSize: 13, color: "#7d7466" }}>{subtitulo}</p> : null}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{acoes}</div>
    </div>
  );
}

export function Conteudo({ children, largura = 1400 }: { children: ReactNode; largura?: number }) {
  return (
    <div style={{ padding: "20px 22px", maxWidth: largura, width: "100%" }}>
      {children}
    </div>
  );
}

export function Secao({
  titulo,
  descricao,
  acoes,
  children,
  padding = true,
}: {
  titulo?: string;
  descricao?: string;
  acoes?: ReactNode;
  children: ReactNode;
  padding?: boolean;
}) {
  return (
    <section className="card" style={{ marginBottom: 18, overflow: "hidden" }}>
      {titulo ? (
        <header
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid #e7e1d6",
            background: "#fdfcfa",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 15.5, color: "#00303c" }}>{titulo}</h2>
            {descricao ? <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#7d7466" }}>{descricao}</p> : null}
          </div>
          <div style={{ flex: 1 }} />
          {acoes}
        </header>
      ) : null}
      <div style={padding ? { padding: 18 } : undefined}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Indicadores                                                         */
/* ------------------------------------------------------------------ */

const CORES_KPI: Record<string, { fundo: string; texto: string }> = {
  teal: { fundo: "linear-gradient(180deg,#00303c,#001a22)", texto: "#fff" },
  ouro: { fundo: "linear-gradient(180deg,#e8c77c,#c8913a)", texto: "#3a2503" },
  claro: { fundo: "#fff", texto: "#3a352e" },
  verde: { fundo: "#e6f5ed", texto: "#166b46" },
  vermelho: { fundo: "#fdeaea", texto: "#9c2b2b" },
  amarelo: { fundo: "#fdf3e0", texto: "#8a5a12" },
};

export function Kpi({
  rotulo,
  valor,
  detalhe,
  variante = "claro",
  href,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  variante?: keyof typeof CORES_KPI;
  href?: string;
}) {
  const c = CORES_KPI[variante] ?? CORES_KPI.claro;
  const interno = (
    <div
      style={{
        background: c.fundo,
        color: c.texto,
        border: variante === "claro" ? "1px solid #e7e1d6" : "none",
        borderRadius: 14,
        padding: "14px 16px",
        height: "100%",
        boxShadow: "0 1px 2px rgba(0,36,48,0.05)",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          fontWeight: 700,
          opacity: variante === "claro" ? 0.6 : 0.72,
        }}
      >
        {rotulo}
      </div>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 24, marginTop: 4, lineHeight: 1.2 }}>{valor}</div>
      {detalhe ? (
        <div style={{ fontSize: 12, opacity: variante === "claro" ? 0.72 : 0.8, marginTop: 3 }}>{detalhe}</div>
      ) : null}
    </div>
  );
  return href ? <Link href={href} style={{ display: "block", height: "100%" }}>{interno}</Link> : interno;
}

export function Grade({ colunas = 4, children, gap = 12 }: { colunas?: number; children: ReactNode; gap?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${Math.floor(1080 / colunas)}px, 1fr))`,
        gap,
        marginBottom: 18,
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

export function SituacaoEstoque({ situacao, disponivel }: { situacao: string; disponivel: number }) {
  const mapa: Record<string, { classe: string; texto: string }> = {
    sem_estoque: { classe: "tag-vermelho", texto: "SEM ESTOQUE" },
    critico: { classe: "tag-vermelho", texto: "CRITICO" },
    repor: { classe: "tag-amarelo", texto: "REPOR" },
    excesso: { classe: "tag-azul", texto: "EXCESSO" },
    ok: { classe: "tag-verde", texto: "OK" },
  };
  const m = mapa[situacao] ?? mapa.ok;
  return <span className={"tag " + m.classe}>{m.texto} {Math.round(disponivel)}</span>;
}

export function TagStatus({ status }: { status: string }) {
  const mapa: Record<string, string> = {
    ativo: "tag-verde",
    inativo: "tag-cinza",
    descontinuado: "tag-vermelho",
    concluida: "tag-verde",
    cancelada: "tag-vermelho",
    devolvida_parcial: "tag-amarelo",
    devolvida_total: "tag-vermelho",
    aberto: "tag-verde",
    fechado: "tag-cinza",
    rascunho: "tag-cinza",
    confirmado: "tag-verde",
  };
  return <span className={"tag " + (mapa[status] ?? "tag-cinza")}>{status.replace(/_/g, " ")}</span>;
}

export function CorBolinha({ hex, codigo, nome }: { hex?: string | null; codigo?: string | null; nome?: string | null }) {
  if (!hex && !codigo) return <span style={{ color: "#7d7466" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          background: hex || "#ccc",
          border: "1px solid #d5ccba",
          flexShrink: 0,
          display: "inline-block",
        }}
      />
      <span>{codigo ? <strong>{codigo}</strong> : null}{nome ? ` ${nome}` : ""}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Vazio                                                               */
/* ------------------------------------------------------------------ */

export function Vazio({ titulo, descricao, acao }: { titulo: string; descricao?: string; acao?: ReactNode }) {
  return (
    <div style={{ padding: "44px 20px", textAlign: "center", color: "#7d7466" }}>
      <div style={{ fontSize: 33, opacity: 0.3 }}>✦</div>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: "#3a352e", marginTop: 8 }}>{titulo}</div>
      {descricao ? <p style={{ fontSize: 13.5, marginTop: 5, maxWidth: 480, margin: "5px auto 0" }}>{descricao}</p> : null}
      {acao ? <div style={{ marginTop: 15 }}>{acao}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Campos de formulario (server-safe)                                  */
/* ------------------------------------------------------------------ */

export function Campo({
  rotulo,
  nome,
  valor,
  tipo = "text",
  placeholder,
  obrigatorio,
  ajuda,
  largura,
  step,
  disabled,
  max,
  min,
}: {
  rotulo: string;
  nome: string;
  valor?: string | number | null;
  tipo?: string;
  placeholder?: string;
  obrigatorio?: boolean;
  ajuda?: string;
  largura?: number | string;
  step?: string;
  disabled?: boolean;
  max?: string | number;
  min?: string | number;
}) {
  return (
    <div style={{ width: largura }}>
      <label htmlFor={nome}>
        {rotulo} {obrigatorio ? <span style={{ color: "#9c2b2b" }}>*</span> : null}
      </label>
      <input
        id={nome}
        name={nome}
        type={tipo}
        defaultValue={valor ?? ""}
        placeholder={placeholder}
        required={obrigatorio}
        step={step}
        disabled={disabled}
        max={max}
        min={min}
      />
      {ajuda ? <div style={{ fontSize: 11.5, color: "#7d7466", marginTop: 4 }}>{ajuda}</div> : null}
    </div>
  );
}

export function CampoSelect({
  rotulo,
  nome,
  opcoes,
  valor,
  placeholder,
  ajuda,
  largura,
  obrigatorio,
}: {
  rotulo: string;
  nome: string;
  opcoes: { valor: string | number; texto: string }[];
  valor?: string | number | null;
  placeholder?: string;
  ajuda?: string;
  largura?: number | string;
  obrigatorio?: boolean;
}) {
  return (
    <div style={{ width: largura }}>
      <label htmlFor={nome}>
        {rotulo} {obrigatorio ? <span style={{ color: "#9c2b2b" }}>*</span> : null}
      </label>
      <select id={nome} name={nome} defaultValue={valor === null || valor === undefined ? "" : String(valor)} required={obrigatorio}>
        <option value="">{placeholder ?? "— selecione —"}</option>
        {opcoes.map((o) => (
          <option key={String(o.valor)} value={String(o.valor)}>
            {o.texto}
          </option>
        ))}
      </select>
      {ajuda ? <div style={{ fontSize: 11.5, color: "#7d7466", marginTop: 4 }}>{ajuda}</div> : null}
    </div>
  );
}

export function CampoArea({
  rotulo,
  nome,
  valor,
  placeholder,
  linhas = 3,
  ajuda,
}: {
  rotulo: string;
  nome: string;
  valor?: string | null;
  placeholder?: string;
  linhas?: number;
  ajuda?: string;
}) {
  return (
    <div>
      <label htmlFor={nome}>{rotulo}</label>
      <textarea id={nome} name={nome} defaultValue={valor ?? ""} placeholder={placeholder} rows={linhas} />
      {ajuda ? <div style={{ fontSize: 11.5, color: "#7d7466", marginTop: 4 }}>{ajuda}</div> : null}
    </div>
  );
}

export function Linha({ children, colunas, gap = 12 }: { children: ReactNode; colunas?: string; gap?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: colunas ?? "repeat(auto-fit, minmax(180px, 1fr))", gap, marginBottom: 12 }}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabela                                                              */
/* ------------------------------------------------------------------ */

export function Tabela({ children, maxAltura }: { children: ReactNode; maxAltura?: number }) {
  return (
    <div style={{ overflowX: "auto", maxHeight: maxAltura, overflowY: maxAltura ? "auto" : undefined }}>
      <table className="tabela-sistema">{children}</table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Barra de progresso simples (curva ABC, participacao)                */
/* ------------------------------------------------------------------ */

export function Barra({ pct, cor = "#0a5c6b" }: { pct: number; cor?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ background: "#f2eee6", borderRadius: 5, height: 7, width: "100%", overflow: "hidden" }}>
      <div style={{ width: p + "%", height: "100%", background: cor, borderRadius: 5 }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grafico de barras em SVG puro (sem dependencia externa)             */
/* ------------------------------------------------------------------ */

export function GraficoBarras({
  dados,
  altura = 190,
  cor = "#0a5c6b",
  formato = (v: number) => String(Math.round(v)),
}: {
  dados: { rotulo: string; valor: number }[];
  altura?: number;
  cor?: string;
  formato?: (v: number) => string;
}) {
  if (!dados.length) return <Vazio titulo="Sem dados no periodo" />;
  const max = Math.max(...dados.map((d) => d.valor), 1);
  const larguraBarra = 100 / dados.length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", height: altura, gap: 3, paddingBottom: 22, position: "relative" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <div
            key={f}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 22 + f * (altura - 22),
              borderTop: "1px dashed #f2eee6",
              pointerEvents: "none",
            }}
          />
        ))}
        {dados.map((d, i) => (
          <div
            key={i}
            title={`${d.rotulo}: ${formato(d.valor)}`}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              height: "100%",
              position: "relative",
            }}
          >
            <div
              style={{
                height: (d.valor / max) * (altura - 22) + "px",
                background: cor,
                borderRadius: "4px 4px 0 0",
                minHeight: d.valor > 0 ? 3 : 0,
                transition: "height .2s",
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 3, marginTop: -20 }}>
        {dados.map((d, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 9.5,
              color: "#7d7466",
              overflow: "hidden",
              whiteSpace: "nowrap",
              transform: dados.length > 20 ? "rotate(-55deg)" : undefined,
            }}
          >
            {d.rotulo}
          </div>
        ))}
      </div>
    </div>
  );
}
