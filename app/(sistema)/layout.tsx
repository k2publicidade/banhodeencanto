import { exigir } from "@/lib/auth";
import { one } from "@/lib/db";
import Sidebar from "@/components/Sidebar";

export const dynamic = "force-dynamic";

export default async function LayoutSistema({ children }: { children: React.ReactNode }) {
  const usuario = await exigir();

  const caixa = one<{ id: number; abertura_em: string; terminal: string | null }>(
    "SELECT id, abertura_em, terminal FROM caixas WHERE status = 'aberto' ORDER BY id DESC LIMIT 1"
  );

  return (
    <div className="nao-imprimir" style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar nome={usuario.nome} apelido={usuario.apelido} papel={usuario.papel} />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}
