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
 *   npm run apresentar -- --online      # publica tambem um link na internet (tunel Cloudflare)
 *
 * Para encerrar: Ctrl+C. Rodar de novo restaura o banco limpo.
 */
import { existsSync, mkdirSync, renameSync } from "node:fs";
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
const ONLINE = argv.includes("--online");
const RAIZ = process.cwd();
const DIR_DADOS = join(RAIZ, "data");
const BANCO_DEMO = join(DIR_DADOS, "apresentacao.db");

const linha = (t = "") => console.log(t);

/**
 * true se outro processo estiver com o banco aberto.
 * No Windows, renomear um arquivo aberto falha: usa isso como prova, sem risco
 * de perder dados (se o rename der certo, volta o nome na hora).
 */
function bancoEmUso(caminho) {
  if (!existsSync(caminho)) return false;
  const teste = caminho + ".emuso";
  try {
    renameSync(caminho, teste);
    renameSync(teste, caminho);
    return false;
  } catch {
    try {
      if (existsSync(teste) && !existsSync(caminho)) renameSync(teste, caminho);
    } catch {
      /* ignorado */
    }
    return true;
  }
}
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
    // Seguranca em primeiro lugar: se o banco de demonstracao estiver aberto por
    // outro processo (servidor rodando) ou tiver sobrado um arquivo de transacao,
    // recriar por baixo dele pode corromper dados. Nesse caso, avisa e para.
    if (bancoEmUso(BANCO_DEMO)) {
      linha("  o banco de demonstracao esta em uso (o servidor de apresentacao ja esta");
      linha("  rodando nesta pasta). Feche aquela janela (Ctrl+C) e rode de novo, ou use");
      linha("  --sem-reset para continuar de onde parou.");
      process.exit(1);
    }

    // Sobras de uma execucao interrompida (-wal/-shm) nao podem acompanhar o banco
    // novo; como ninguem esta usando, podem ser descartadas com seguranca.
    const { rmSync } = await import("node:fs");
    for (const s of ["-wal", "-shm"]) {
      try {
        rmSync(BANCO_DEMO + s, { force: true });
      } catch {
        linha(`  nao consegui apagar ${BANCO_DEMO + s} (arquivo travado).`);
        linha("  Feche o servidor que estiver aberto e rode de novo.");
        process.exit(1);
      }
    }

    // Copia para um arquivo novo e so entao troca o oficial: nunca deixa o banco
    // pela metade, nem substitui o arquivo em uso.
    const { copyFileSync, renameSync } = await import("node:fs");
    try {
      const db = new DatabaseSync(origem);
      db.exec("PRAGMA busy_timeout = 8000;");
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      db.close();
    } catch {
      /* origem em uso por outro motivo: copia mesmo assim */
    }
    const novo = BANCO_DEMO + ".novo";
    copyFileSync(origem, novo);
    try {
      renameSync(novo, BANCO_DEMO);
    } catch {
      try {
        rmSync(novo, { force: true });
      } catch {
        /* ignorado */
      }
      linha("  nao consegui trocar o banco de demonstracao (arquivo em uso).");
      linha("  Feche a janela do servidor e rode de novo, ou use --sem-reset.");
      process.exit(1);
    }
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

/* ------------------------------------------------------------------ */
/* 3b. Link publico (opcional): tunel do Cloudflare                    */
/* ------------------------------------------------------------------ */
let tunel = null;
let enderecoPublico = null;

if (ONLINE) {
  // Este PC tem IPv6 instavel (a conexao QUIC por IPv6 cai com "unreachable
  // network"), entao o tunel e fixado no IPv4 e no transporte http2, que e mais
  // tolerante. Assim o link nao cai no meio da apresentacao.
  tunel = spawn(
    "npx",
    ["--yes", "cloudflared", "tunnel", "--url", `http://localhost:${PORTA}`, "--edge-ip-version", "4", "--retries", "10"],
    {
      shell: true,
      env: { ...env, TUNNEL_TRANSPORT_PROTOCOL: "http2" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const procurarEndereco = (bruto) => {
    const texto = String(bruto);
    const achado = texto.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (achado && !enderecoPublico) {
      enderecoPublico = achado[0];
      titulo("Link publico na internet");
      linha(`  ${enderecoPublico}`);
      linha("");
      linha("  Mande esse endereco para o cliente (funciona no celular e no computador).");
      linha("  Ele existe enquanto esta janela estiver aberta.");
    }
  };
  const mostrarProblemas = (bruto) => {
    for (const l of String(bruto).split(/\r?\n/)) {
      if (/\b(ERR|WRN|failed|error)\b/i.test(l) && l.trim()) {
        console.log("  [tunel] " + l.replace(/^\d{4}-\d\d-\d\dT[\d:]+Z\s*/, "").slice(0, 200));
      }
    }
  };
  tunel.stdout.on("data", (b) => {
    procurarEndereco(b);
    mostrarProblemas(b);
  });
  tunel.stderr.on("data", (b) => {
    procurarEndereco(b);
    mostrarProblemas(b);
  });
}

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
  if (ONLINE) {
    linha(`  Link na internet .......: ${enderecoPublico || "aguardando o Cloudflare liberar o endereco (aparece aqui em alguns segundos)"}`);
  }
  linha("");
  linha("  Ctrl+C encerra. Rodar `npm run apresentar` de novo restaura o banco limpo");
  linha("");
}, DEV ? 12000 : 3000);

function encerrarTudo() {
  try {
    if (tunel?.pid) spawnSync("taskkill", ["/PID", String(tunel.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* sem problema: o tunel cai junto com a janela */
  }
  try {
    servidor.kill();
  } catch {
    /* ignorado */
  }
}

process.on("SIGINT", () => {
  encerrarTudo();
  process.exit(0);
});
process.on("SIGTERM", () => {
  encerrarTudo();
  process.exit(0);
});
