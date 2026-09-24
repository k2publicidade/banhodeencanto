/**
 * Mesma divisao do `estoque:dividir`, mas falando direto com um PostgreSQL
 * (Supabase). Serve para dois casos:
 *
 *   1. aplicar o schema atual no banco de producao (`--so-schema`)
 *   2. separar o estoque que esta todo num local entre loja e galpao,
 *      gravando transferencias de verdade (TRF-xxxxx)
 *
 * Uso:
 *   DATABASE_URL=... node scripts/estoque-dividir-postgres.mjs                # simulacao
 *   DATABASE_URL=... node scripts/estoque-dividir-postgres.mjs --so-schema    # so o DDL
 *   DATABASE_URL=... node scripts/estoque-dividir-postgres.mjs --confirmar    # 60% para o galpao
 *   DATABASE_URL=... node scripts/estoque-dividir-postgres.mjs --confirmar --percentual=70
 *
 * Seguranca: aplica o schema (idempotente), cria o galpao se faltar, mostra o
 * antes/depois e confere que o total de pecas continua o mesmo.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = "banho_encanto";

const arg = (nome, padrao = null) => {
  const bruto = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return bruto ? bruto.slice(nome.length + 3) : padrao;
};
const confirmar = process.argv.includes("--confirmar");
const soSchema = process.argv.includes("--so-schema");
const percentual = Math.min(Math.max(Number(arg("percentual", "60")) / 100, 0.05), 0.95);

if (!process.env.DATABASE_URL) {
  console.error("Configure DATABASE_URL (Supabase) antes de rodar.");
  process.exit(2);
}

const url = new URL(process.env.DATABASE_URL);
const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
if (!local && !url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
if (!local && !url.searchParams.has("uselibpqcompat")) url.searchParams.set("uselibpqcompat", "true");
const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 15000 });
const db = await pool.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

try {
  console.log("1. Aplicando lib/schema-postgres.sql (idempotente)...");
  const schema = readFileSync(join(root, "lib", "schema-postgres.sql"), "utf8");
  await db.query(schema);
  console.log("   schema OK (tabelas e views novas garantidas)");

  if (soSchema) {
    const views = await q(`SELECT table_name FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name`, [SCHEMA]);
    console.log("   views: " + views.map((v) => v.table_name).join(", "));
    process.exit(0);
  }

  const resumo = async (id) =>
    (
      await q(
        `SELECT COUNT(DISTINCT e.variacao_id)::int skus, COALESCE(SUM(e.quantidade),0) pecas,
                COALESCE(SUM(e.quantidade * v.custo_medio),0) valor
           FROM ${SCHEMA}.estoque e JOIN ${SCHEMA}.variacoes v ON v.id = e.variacao_id
          WHERE e.loja_id = $1`,
        [id]
      )
    )[0];
  const pecasTotais = async () => (await q(`SELECT COALESCE(SUM(quantidade),0) s FROM ${SCHEMA}.estoque`))[0].s;

  let origem = Number(arg("origem", 0)) || (await q(`SELECT id FROM ${SCHEMA}.lojas WHERE ativa = 1 AND eh_deposito = 0 AND padrao = 1 LIMIT 1`))[0]?.id;
  if (!origem) {
    console.error("Nenhuma loja ativa encontrada para servir de origem.");
    process.exit(1);
  }
  let destino = Number(arg("destino", 0)) || (await q(`SELECT id FROM ${SCHEMA}.lojas WHERE eh_deposito = 1 ORDER BY id LIMIT 1`))[0]?.id;

  const nome = async (id) => (await q(`SELECT nome, eh_deposito FROM ${SCHEMA}.lojas WHERE id = $1`, [id]))[0];
  const lo = await nome(origem);

  if (!destino) {
    if (!confirmar) {
      console.log("\nNao existe galpao cadastrado. Com --confirmar o script cria:");
      console.log("  Galpao / Centro de Distribuicao");
      process.exit(0);
    }
    destino = (await q(
      `INSERT INTO ${SCHEMA}.lojas(nome, apelido, eh_deposito, padrao, ativa) VALUES ($1,$2,1,0,1) RETURNING id`,
      ["Galpao / Centro de Distribuicao", "GALPAO"]
    ))[0].id;
    console.log(`   galpao criado (id ${destino})`);
  }

  const antesOrigem = await resumo(origem);
  const antesDestino = await resumo(destino);
  const antesTotal = await pecasTotais();
  const ld = await nome(destino);

  console.log("\nEstoques");
  console.log(`  origem .: ${lo.nome} - ${antesOrigem.pecas} pecas, R$ ${Number(antesOrigem.valor).toFixed(2)} a custo`);
  console.log(`  destino : ${ld.nome}${ld.eh_deposito ? " (galpao)" : ""} - ${antesDestino.pecas} pecas, R$ ${Number(antesDestino.valor).toFixed(2)} a custo`);
  console.log(`  divisao : ${(percentual * 100).toFixed(0)}% do saldo de cada SKU vai para o destino`);

  const skus = await q(
    `SELECT e.variacao_id, e.quantidade, v.custo_medio
       FROM ${SCHEMA}.estoque e JOIN ${SCHEMA}.variacoes v ON v.id = e.variacao_id
      WHERE e.loja_id = $1 AND e.quantidade >= 3
      ORDER BY e.variacao_id`,
    [origem]
  );
  const plano = skus
    .map((s) => ({ variacao_id: s.variacao_id, quantidade: Math.floor(Number(s.quantidade) * percentual), custo: Number(s.custo_medio ?? 0) }))
    .filter((p) => p.quantidade >= 1);

  if (!confirmar) {
    const pecas = plano.reduce((s, p) => s + p.quantidade, 0);
    console.log(`\nSIMULACAO (sem gravar nada): ${plano.length} SKU(s), ${pecas} peca(s) para o destino.`);
    console.log("Para gravar: adicione --confirmar");
    process.exit(0);
  }

  const jaTem = (await q(`SELECT COUNT(*)::int n FROM ${SCHEMA}.transferencias`))[0].n;
  if (jaTem > 0 && !process.argv.includes("--refazer")) {
    console.log(`\nEste banco ja tem ${jaTem} transferencia(s). Para dividir de novo, use --refazer.`);
    process.exit(0);
  }

  const data = (await q(`SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') d`))[0].d;
  const agora = (await q(`SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS') d`))[0].d;

  let documentos = 0;
  let movidas = 0;
  let valorMovido = 0;
  const numeros = [];

  await db.query("BEGIN");
  try {
    // Alinha a sequencia com o maior numero ja gravado
    await db.query(
      `INSERT INTO ${SCHEMA}.sequencias(nome, ultimo)
       SELECT 'transferencia', COALESCE(MAX(CAST(SUBSTR(numero, 5) AS INTEGER)),0) FROM ${SCHEMA}.transferencias WHERE numero LIKE 'TRF-%'
       ON CONFLICT(nome) DO UPDATE SET ultimo = GREATEST(${SCHEMA}.sequencias.ultimo, excluded.ultimo)`
    );

    for (let i = 0; i < plano.length; i += 15) {
      const lote = plano.slice(i, i + 15);
      const pecas = lote.reduce((s, x) => s + x.quantidade, 0);
      const valor = lote.reduce((s, x) => s + x.quantidade * x.custo, 0);
      const { ultimo } = (await q(`UPDATE ${SCHEMA}.sequencias SET ultimo = ultimo + 1 WHERE nome = 'transferencia' RETURNING ultimo`))[0];
      const numero = "TRF-" + String(ultimo).padStart(5, "0");

      const t = (
        await q(
          `INSERT INTO ${SCHEMA}.transferencias(numero, loja_origem, loja_destino, data, status, itens, pecas, valor_custo,
             observacoes, usuario_nome, criado_em)
           VALUES ($1,$2,$3,$4,'concluida',$5,$6,$7,$8,$9,$10) RETURNING id`,
          [numero, origem, destino, data, lote.length, pecas, Math.round(valor * 100) / 100,
           "Transferencia de abertura do galpao", "Administrador", agora]
        )
      )[0];

      for (const it of lote) {
        await db.query(
          `INSERT INTO ${SCHEMA}.transferencias_itens(transferencia_id, variacao_id, quantidade, custo_unitario) VALUES ($1,$2,$3,$4)`,
          [t.id, it.variacao_id, it.quantidade, it.custo]
        );
        const mov = async (lojaId, tipo, delta, motivo) => {
          const atual = (await q(`SELECT quantidade FROM ${SCHEMA}.estoque WHERE variacao_id = $1 AND loja_id = $2`, [it.variacao_id, lojaId]))[0];
          const antes = Number(atual?.quantidade ?? 0);
          const depois = antes + delta;
          if (atual) {
            await db.query(
              `UPDATE ${SCHEMA}.estoque SET quantidade = $1, atualizado_em = $2 WHERE variacao_id = $3 AND loja_id = $4`,
              [depois, agora, it.variacao_id, lojaId]
            );
          } else {
            await db.query(`INSERT INTO ${SCHEMA}.estoque(variacao_id, loja_id, quantidade, reservado) VALUES ($1,$2,$3,0)`, [it.variacao_id, lojaId, depois]);
          }
          await db.query(
            `INSERT INTO ${SCHEMA}.estoque_movimentos(variacao_id, loja_id, tipo, quantidade, saldo_anterior, saldo_apos,
               custo_unitario, documento, motivo, referencia_tipo, referencia_id, criado_em)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'transferencia',$10,$11)`,
            [it.variacao_id, lojaId, tipo, Math.abs(delta), antes, depois, it.custo, numero, motivo, t.id, agora]
          );
        };
        await mov(origem, "transferencia_saida", -it.quantidade, `Transferencia para o estoque ${destino}`);
        await mov(destino, "transferencia_entrada", it.quantidade, `Transferencia do estoque ${origem}`);
      }

      documentos++;
      movidas += pecas;
      valorMovido += valor;
      numeros.push(numero);
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }

  const depoisOrigem = await resumo(origem);
  const depoisDestino = await resumo(destino);
  const depoisTotal = await pecasTotais();

  console.log("\nDepois da divisao");
  console.log(`  ${lo.nome}: ${depoisOrigem.pecas} pecas (${depoisOrigem.skus} SKUs)`);
  console.log(`  ${ld.nome}: ${depoisDestino.pecas} pecas (${depoisDestino.skus} SKUs)`);
  console.log(`  Transferencias: ${documentos} documento(s) ${numeros.slice(0, 3).join(", ")}${numeros.length > 3 ? " ..." : ""}`);
  console.log(`  Pecas movimentadas: ${movidas} | R$ ${valorMovido.toFixed(2)} a custo`);

  if (Number(antesTotal) !== Number(depoisTotal)) {
    console.error(`\nERRO: o total de pecas mudou (${antesTotal} -> ${depoisTotal}).`);
    process.exit(1);
  }
  console.log(`\nConfere: total de pecas continua ${depoisTotal}. OK`);
} finally {
  db.release();
  await pool.end();
}
