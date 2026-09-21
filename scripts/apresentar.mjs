/**
 * MODO APRESENTACAO
 *
 * Sobe o sistema em build de producao (sem a barra de desenvolvimento do Next),
 * com um banco de demonstracao separado dos seus dados e ja carregado com a
 * base de exemplo (90 dias de movimento). Serve para mostrar ao cliente.
 *
 *   npm run apresentar                 # reseta o banco de demonstracao e sobe
 *   npm run apresentar -- --sem-reset   # sobe sem apagar o que ja foi feito
 *   npm run apresentar -- --porta=3000  # escolhe a porta (padrao 3000)
 *   npm run apresentar -- --dev         # usa o dev server (para editar codigo)
 *
 * Para encerrar: Ctrl+C. Rodar de novo restaura o banco limpo.
 */
import { existsSync, mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const arg = (nome, padrao) => {
  const achado = argv.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
};

const PORTA = Number(arg("porta", "3000"));
const RESETAR = !argv.includes("--sem-reset");
const DEV = argv.includes("--dev");
const RAIZ = process.cwd();
const DIR_DADOS = join(RAIZ, "data");
const BANCO_DEMO = join(DIR_DADOS, "apresentacao.db");

const linha = (t = "") => console.log(t);
const dinheiro = (n) => Number(n).toFixed(2).replace(".", ",");
const titulo = (t) => linha("\n" + t + "\n" + "-".repeat(t.length));

/* ------------------------------------------------------------------ */
/* 1. Banco de demonstracao limpo                                      */
/* ------------------------------------------------------------------ */
titulo("1/3  Banco de demonstracao");

mkdirSync(DIR_DADOS, { recursive: true });

if (!RESETAR && existsSync(BANCO_DEMO)) {
  linha("  mantido o banco atual de demonstracao (--sem-reset)");
} else {
  // Se o banco de demonstracao nao existe, cria a partir do seu banco local
  // (mesma base que voce ja usa) - assim a apresentacao mostra dados reaisista.
  const origem = join(DIR_DADOS, "banho.db");
  const jaTemBase = existsSync(origem);

  const env = { ...process.env, BDE_DB_PATH: BANCO_DEMO };

  if (jaTemBase) {
    // Copia consistente do banco atual (com WAL aplicado) para nao mostrar banco vazio
    const { copyFileSync, rmSync } = await import("node:fs");
    const { DatabaseSync } = await import("node:sqlite");
    try {
      const db = new DatabaseSync(origem);
      db.exec("PRAGMA busy_timeout = 8000;");
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      db.close();
    } catch {
      /* se estiver em uso, copia mesmo assim */
    }
    for (const s of ["-wal", "-shm"]) rmSync(BANCO_DEMO + s, { force: true });
    copyFileSync(origem, BANCO_DEMO);
    linha("  banco de demonstracao recriado a partir de data/banho.db");
  } else {
    // Sem banco local: cria vazio e carrega a carga de demonstracao
    const r = spawnSync(process.execPath, [join(RAIZ, "scripts", "db-reset.mjs"), "--confirmar", "--com-dados", `--banco=${BANCO_DEMO}`], {
      stdio: "inherit",
      env,
    });
    if (r.status !== 0) {
      linha("  nao consegui criar o banco de demonstracao");
      process.exit(1);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 2. Build de producao                                                */
/* ------------------------------------------------------------------ */
titulo("2/3  Preparando o sistema" + (DEV ? " (dev server)" : " (build de producao)"));

if (DEV) {
  linha("  pulando o build: modo dev usa compilacao sob demanda");
} else if (!existsSync(join(RAIZ, ".next", "BUILD_ID"))) {
  linha("  compilando (primeira vez, leva ~1 min)...");
  const r = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    linha("  falhou o build");
    process.exit(1);
  }
} else {
  linha("  build encontrado em .next (roda rapido; o build so e refeito se apagar .next)");
}

/* ------------------------------------------------------------------ */
/* 3. Sobe o sistema                                                   */
/* ------------------------------------------------------------------ */
const env = { ...process.env, BDE_DB_PATH: BANCO_DEMO, PORT: String(PORTA), TZ: "America/Sao_Paulo" };
delete env.NODE_ENV;

const comando = DEV ? [join(RAIZ, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(PORTA)] : [join(RAIZ, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORTA)];
const servidor = spawn(process.execPath, comando, { stdio: "inherit", env });

function ipDaRede() {
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254")) return i.address;
    }
  }
  return null;
}

const ip = ipDaRede();

/** Estado do caixa no banco da apresentacao (para o apresentador saber onde comeca) */
function estadoCaixa() {
  try {
    const db = new DatabaseSync(BANCO_DEMO);
    const cx = db.prepare("SELECT terminal, valor_abertura FROM caixas WHERE status='aberto' ORDER BY id DESC LIMIT 1").get();
    const v = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM vendas WHERE date(data)=date('now','localtime')").get();
    db.close();
    return {
      caixa: cx ? `ABERTO (${cx.terminal || "CAIXA"}, fundo R$ ${dinheiro(cx.valor_abertura)})` : "fechado",
      hoje: `${v.n} venda(s), R$ ${dinheiro(v.t)}`,
    };
  } catch {
    return null;
  }
}

setTimeout(() => {
  titulo("3/3  Sistema no ar - pronto para apresentar");
  linha(`  Neste computador .......: http://localhost:${PORTA}`);
  if (ip) linha(`  No celular (mesma rede) : http://${ip}:${PORTA}`);
  linha("");
  linha(`  Banco da apresentacao ..: ${BANCO_DEMO}`);
  const st = estadoCaixa();
  if (st) {
    linha(`  Estado inicial .........: caixa ${st.caixa} | hoje: ${st.hoje}`);
  }
  linha("  Acessos:");
  linha("    Administrador .......: admin@banhodeencanto.com.br / encanto123");
  linha("    Operador de caixa ...: caixa@banhodeencanto.com.br / encanto123   (PIN 1234)");
  linha("");
  linha("  Dicas para a demonstracao:");
  linha("    - PDV: bipe/digite qualquer codigo de barras do estoque, ajuste a quantidade,");
  linha("      aplique 30% de desconto (pede PIN do supervisor: 1234 ou a senha do admin)");
  linha("      e finalize: o cupom aparece para imprimir.");
  linha("    - Vendas: abra a venda recem feita e registre uma devolucao; o estoque volta.");
  linha("    - Painel e Relatorios: numeros do dia, curva ABC e margem.");
  linha("");
  linha("  Ctrl+C encerra. Rodar `npm run apresentar` de novo restaura o banco limpo.");
  linha("");
}, DEV ? 12000 : 3000);

process.on("SIGINT", () => {
  servidor.kill();
  process.exit(0);
});
