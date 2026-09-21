import Link from "next/link";
import { Children, cloneElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";

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
    <div className="pagina-cabecalho nao-imprimir">
      <div style={{ minWidth: 0 }}>
        <h1>{titulo}</h1>
        {subtitulo ? <p>{subtitulo}</p> : null}
      </div>
      {acoes ? <div className="pagina-acoes">{acoes}</div> : null}
    </div>
  );
}

export function Conteudo({ children, largura = 1440 }: { children: ReactNode; largura?: number }) {
  return (
    <div className="pagina-conteudo" style={{ maxWidth: largura }}>
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
    <section className="card" style={{ marginBottom: 16, overflow: "hidden" }}>
      {titulo ? (
        <header
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--color-creme-300)",
            background: "#fdfcfa",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 15.5, color: "var(--color-encanto-800)" }}>{titulo}</h2>
            {descricao ? (
              <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--color-creme-600)" }}>{descricao}</p>
            ) : null}
          </div>
          {acoes}
        </header>
      ) : null}
      <div style={padding ? { padding: 16 } : undefined}>{children}</div>
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
        border: variante === "claro" ? "1px solid var(--color-creme-300)" : "none",
        borderRadius: 14,
        padding: "13px 14px",
        height: "100%",
        boxShadow: "var(--sombra-1)",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 700,
          opacity: variante === "claro" ? 0.6 : 0.72,
          lineHeight: 1.25,
        }}
      >
        {rotulo}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(19px, 5.6vw, 24px)",
          marginTop: 4,
          lineHeight: 1.15,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {valor}
      </div>
      {detalhe ? (
        <div style={{ fontSize: 11.5, opacity: variante === "claro" ? 0.72 : 0.82, marginTop: 3, lineHeight: 1.3 }}>
          {detalhe}
        </div>
      ) : null}
    </div>
  );
  return href ? (
    <Link href={href} style={{ display: "block", height: "100%" }}>
      {interno}
    </Link>
  ) : (
    interno
  );
}

/** Grade de indicadores: 2 colunas no celular, `colunas` no desktop. */
export function Grade({
  colunas = 4,
  children,
  gap,
}: {
  colunas?: number;
  children: ReactNode;
  gap?: number;
}) {
  return (
    <div
      className={"grade" + (colunas === 1 ? " so-um" : "")}
      style={{ "--cols": colunas, ...(gap ? { gap } : {}) } as React.CSSProperties}
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
  return (
    <span className={"tag " + m.classe}>
      {m.texto} {Math.round(disponivel)}
    </span>
  );
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
  if (!hex && !codigo) return <span style={{ color: "var(--color-creme-600)" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          background: hex || "#ccc",
          border: "1px solid var(--color-creme-400)",
          flexShrink: 0,
          display: "inline-block",
        }}
      />
      <span>
        {codigo ? <strong>{codigo}</strong> : null}
        {nome ? ` ${nome}` : ""}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Vazio                                                               */
/* ------------------------------------------------------------------ */

export function Vazio({ titulo, descricao, acao }: { titulo: string; descricao?: string; acao?: ReactNode }) {
  return (
    <div style={{ padding: "34px 16px", textAlign: "center", color: "var(--color-creme-600)" }}>
      <div style={{ fontSize: 30, opacity: 0.28 }}>✦</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 16.5, color: "var(--color-creme-800)", marginTop: 8 }}>
        {titulo}
      </div>
      {descricao ? (
        <p style={{ fontSize: 13.5, marginTop: 5, maxWidth: 480, margin: "5px auto 0", lineHeight: 1.5 }}>{descricao}</p>
      ) : null}
      {acao ? <div style={{ marginTop: 14 }}>{acao}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Campos de formulario                                                */
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
  inputMode,
  autoComplete,
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
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "search";
  autoComplete?: string;
}) {
  return (
    <div style={{ width: largura, minWidth: 0 }}>
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
        inputMode={inputMode}
        autoComplete={autoComplete}
      />
      {ajuda ? <div style={{ fontSize: 11.5, color: "var(--color-creme-600)", marginTop: 4 }}>{ajuda}</div> : null}
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
    <div style={{ width: largura, minWidth: 0 }}>
      <label htmlFor={nome}>
        {rotulo} {obrigatorio ? <span style={{ color: "#9c2b2b" }}>*</span> : null}
      </label>
      <select
        id={nome}
        name={nome}
        defaultValue={valor === null || valor === undefined ? "" : String(valor)}
        required={obrigatorio}
      >
        <option value="">{placeholder ?? "— selecione —"}</option>
        {opcoes.map((o) => (
          <option key={String(o.valor)} value={String(o.valor)}>
            {o.texto}
          </option>
        ))}
      </select>
      {ajuda ? <div style={{ fontSize: 11.5, color: "var(--color-creme-600)", marginTop: 4 }}>{ajuda}</div> : null}
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
      {ajuda ? <div style={{ fontSize: 11.5, color: "var(--color-creme-600)", marginTop: 4 }}>{ajuda}</div> : null}
    </div>
  );
}

/**
 * Linha de campos: empilha no celular e usa as colunas pedidas no desktop.
 * `colunas` aceita qualquer valor de grid-template-columns (ex: "2fr auto").
 */
export function Linha({
  children,
  colunas,
  gap = 12,
}: {
  children: ReactNode;
  colunas?: string;
  gap?: number;
}) {
  return (
    <div
      className="linha-campos"
      style={{ gap, ...(colunas ? ({ "--cols-desktop": colunas } as React.CSSProperties) : {}) }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabela: rolagem lateral no desktop, cartoes no celular              */
/* ------------------------------------------------------------------ */

function textoDe(no: ReactNode): string {
  if (no === null || no === undefined || typeof no === "boolean") return "";
  if (typeof no === "string" || typeof no === "number") return String(no);
  if (Array.isArray(no)) return no.map(textoDe).join(" ").replace(/\s+/g, " ").trim();
  if (isValidElement(no)) {
    const props = no.props as { children?: ReactNode; alt?: string } | null;
    return textoDe(props?.children) || (props?.alt ?? "");
  }
  return "";
}

function rotulosDoCabecalho(children: ReactNode): string[] {
  const thead = Children.toArray(children).find(
    (f) => isValidElement(f) && (f as ReactElement).type === "thead"
  ) as ReactElement | undefined;
  if (!thead) return [];
  const linha = Children.toArray((thead.props as { children?: ReactNode }).children).find(
    (f) => isValidElement(f) && (f as ReactElement).type === "tr"
  ) as ReactElement | undefined;
  if (!linha) return [];
  return Children.toArray((linha.props as { children?: ReactNode }).children).map((th) =>
    textoDe((th as ReactElement | null)?.props ? ((th as ReactElement).props as { children?: ReactNode }).children : null).trim()
  );
}

/**
 * Marca cada celula com o rotulo da coluna (data-rotulo) para que, no celular,
 * a tabela vire uma lista de cartoes legivel - sem repetir rotulos a mao em
 * cada pagina.
 */
function marcarCelulas(children: ReactNode, rotulos: string[], principal: number): ReactNode {
  return Children.map(children, (filho) => {
    if (!isValidElement(filho)) return filho;
    if ((filho as ReactElement).type !== "tbody") return filho;
    const linhas = Children.toArray(((filho as ReactElement).props as { children?: ReactNode }).children).map((tr) => {
      if (!isValidElement(tr)) return tr;
      const celulas = Children.toArray(((tr as ReactElement).props as { children?: ReactNode }).children);
      if (celulas.some((td) => isValidElement(td) && (td.props as { colSpan?: number })?.colSpan)) return tr;
      const novas = celulas.map((td, i) => {
        if (!isValidElement(td)) return td;
        const rotulo = rotulos[i] ?? "";
        const props: Record<string, string> = {};
        if (rotulo) props["data-rotulo"] = rotulo;
        if (i === principal) props["data-principal"] = "1";
        if (i === celulas.length - 1 && i !== principal) props["data-acoes"] = "1";
        return Object.keys(props).length ? cloneElement(td as ReactElement, props) : td;
      });
      return cloneElement(tr as ReactElement, {}, ...novas);
    });
    return cloneElement(filho as ReactElement, {}, ...linhas);
  });
}

export function Tabela({
  children,
  maxAltura,
  cartoes = true,
  principal = 0,
}: {
  children: ReactNode;
  maxAltura?: number;
  /** No celular, transforma cada linha em um cartao com os rotulos das colunas. */
  cartoes?: boolean;
  /** Indice da coluna que vira o titulo do cartao (0 = primeira). */
  principal?: number;
}) {
  const rotulos = cartoes ? rotulosDoCabecalho(children) : [];
  const conteudo = cartoes && rotulos.length ? marcarCelulas(children, rotulos, principal) : children;

  return (
    <div
      className={"tabela-scroll" + (cartoes && rotulos.length ? "" : " tem-mais")}
      style={{ maxHeight: maxAltura, overflowY: maxAltura ? "auto" : undefined }}
    >
      <table className={"tabela-sistema" + (cartoes && rotulos.length ? " tabela-vira-cartoes" : "")}>{conteudo}</table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Barra de progresso e grafico                                        */
/* ------------------------------------------------------------------ */

export function Barra({ pct, cor = "#0a5c6b" }: { pct: number; cor?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ background: "var(--color-creme-200)", borderRadius: 5, height: 7, width: "100%", overflow: "hidden" }}>
      <div style={{ width: p + "%", height: "100%", background: cor, borderRadius: 5 }} />
    </div>
  );
}

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

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          height: altura,
          gap: 3,
          paddingBottom: 22,
          position: "relative",
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <div
            key={f}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 22 + f * (altura - 22),
              borderTop: "1px dashed var(--color-creme-200)",
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
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              height: "100%",
              position: "relative",
            }}
          >
            <div
              style={{
                height: altura - 22,
                background: cor,
                borderRadius: "4px 4px 0 0",
                transform: `scaleY(${d.valor > 0 ? Math.max(d.valor / max, 0.012) : 0})`,
                transformOrigin: "bottom",
                transition: "transform .2s",
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
              minWidth: 0,
              textAlign: "center",
              fontSize: 9.5,
              color: "var(--color-creme-600)",
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
