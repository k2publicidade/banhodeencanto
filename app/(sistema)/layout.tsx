import { exigir } from "@/lib/auth";
import { one } from "@/lib/db";
import Sidebar from "@/components/Sidebar";
import NavegacaoMobile from "@/components/NavegacaoMobile";

export const dynamic = "force-dynamic";

export default async function LayoutSistema({ children }: { children: React.ReactNode }) {
  const usuario = await exigir();

  const caixa = one<{ id: number; abertura_em: string; terminal: string | null }>(
    "SELECT id, abertura_em, terminal FROM caixas WHERE status = 'aberto' ORDER BY id DESC LIMIT 1"
  );

  return (
    <div className="app nao-imprimir">
      <Sidebar nome={usuario.nome} apelido={usuario.apelido} papel={usuario.papel} />

      <NavegacaoMobile
        usuario={{ nome: usuario.apelido || usuario.nome, papel: usuario.papel }}
        caixaAberto={!!caixa}
      />

      <div className="app-corpo">{children}</div>
    </div>
  );
}

/**
 * No celular o layout e: barra de topo fixa + conteudo + barra de abas fixa.
 * O respiro no fim do conteudo (para o conteudo nao ficar sob as abas) esta em
 * .pagina-conteudo, no globals.css.
 */
