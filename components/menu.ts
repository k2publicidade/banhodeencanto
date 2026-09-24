/**
 * Menu do sistema em um unico lugar: a barra lateral (desktop), a gaveta e a
 * barra inferior (celular) leem daqui, entao nada fica dessincronizado.
 */

export type ItemMenu = {
  href: string;
  rotulo: string;
  icone: string;
  /** Rotulo curto usado nas abas do rodape */
  curto?: string;
};

export type GrupoMenu = { titulo: string; itens: ItemMenu[] };

export const MENU: GrupoMenu[] = [
  {
    titulo: "Operacao",
    itens: [
      { href: "/caixa", rotulo: "PDV / Caixa", icone: "▣", curto: "Caixa" },
      { href: "/painel", rotulo: "Painel", icone: "◈" },
      { href: "/vendas", rotulo: "Vendas", icone: "≡" },
    ],
  },
  {
    titulo: "Catalogo",
    itens: [
      { href: "/produtos", rotulo: "Produtos e SKUs", icone: "❖", curto: "Produtos" },
      { href: "/estoque", rotulo: "Estoques", icone: "▤" },
      { href: "/estoque/transferencia", rotulo: "Transferir estoque", icone: "⇄" },
      { href: "/compras", rotulo: "Compras", icone: "▽" },
      { href: "/fornecedores", rotulo: "Fornecedores", icone: "◇" },
    ],
  },
  {
    titulo: "Gestao",
    itens: [
      { href: "/clientes", rotulo: "Clientes e Fiado", icone: "☺" },
      { href: "/relatorios", rotulo: "Relatorios", icone: "▨" },
      { href: "/cadastros", rotulo: "Cadastros auxiliares", icone: "⚙" },
      { href: "/configuracoes", rotulo: "Configuracoes", icone: "✦" },
    ],
  },
];

/** Abas fixas do rodape no celular. */
export const MENU_RODAPE: ItemMenu[] = [
  { href: "/caixa", rotulo: "PDV / Caixa", icone: "▣", curto: "PDV" },
  { href: "/painel", rotulo: "Painel", icone: "◈", curto: "Painel" },
  { href: "/vendas", rotulo: "Vendas", icone: "≡", curto: "Vendas" },
  { href: "/produtos", rotulo: "Produtos e SKUs", icone: "❖", curto: "Produtos" },
];

export const TODOS_ITENS: ItemMenu[] = MENU.flatMap((g) => g.itens);

/** Titulos de telas que nao estao no menu (detalhes e telas auxiliares). */
const TITULOS_EXTRA: { prefixo: string; rotulo: string }[] = [
  { prefixo: "/caixa", rotulo: "PDV / Caixa" },
  { prefixo: "/produtos/novo", rotulo: "Novo produto" },
  { prefixo: "/produtos/", rotulo: "Detalhe do produto" },
  { prefixo: "/clientes/", rotulo: "Ficha do cliente" },
  { prefixo: "/vendas/", rotulo: "Detalhe da venda" },
  { prefixo: "/compras/nova", rotulo: "Nova compra" },
  { prefixo: "/estoque/movimentos", rotulo: "Movimentacoes de estoque" },
  { prefixo: "/estoque/transferencia", rotulo: "Transferir entre estoques" },
  { prefixo: "/configuracoes/usuarios", rotulo: "Usuarios" },
  { prefixo: "/configuracoes/lojas", rotulo: "Estoques e locais" },
  { prefixo: "/cadastros/", rotulo: "Cadastros auxiliares" },
];

export function itemAtivo(caminho: string, href: string) {
  return caminho === href || caminho.startsWith(href + "/");
}

/** Titulo amigavel da tela atual (usado na barra de topo do celular). */
export function tituloDaRota(caminho: string): string {
  const exato = TODOS_ITENS.find((i) => itemAtivo(caminho, i.href) && !TITULOS_EXTRA.some((t) => t.prefixo === i.href && t.prefixo !== caminho));
  const extra = TITULOS_EXTRA.find((t) => caminho.startsWith(t.prefixo));
  if (extra && !TODOS_ITENS.some((i) => i.href === caminho)) return extra.rotulo;
  return exato?.rotulo ?? "Banho de Encanto";
}
