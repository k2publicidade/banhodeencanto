# Como publicar o sistema (e por que a Vercel nao serve)

## O ponto central: o banco e um arquivo

O sistema guarda tudo num **arquivo SQLite** (`data/banho.db`), lido e escrito
diretamente pelo processo do Node. Isso e o que da a simplicidade (nenhum servidor de
banco para administrar) e o que define onde ele pode rodar: **em algum lugar com disco,
onde o arquivo vive e sobrevive entre uma requisicao e outra**.

## Por que a Vercel nao funciona

A Vercel executa cada requisicao num ambiente serverless, com o sistema de arquivos
**somente leitura** e sem estado compartilhado. O que acontece no deploy atual:

```
Error: [db] ENOENT: no such file or directory, mkdir '/var/task/data'
GET /login -> HTTP 500
```

O build passa, o link abre e responde, mas a primeira consulta ao banco derruba a
pagina - nao existe pasta `data` (ela nao vai para o repositorio, sao dados da loja)
e nao ha onde gravar.

Para rodar na Vercel seria preciso trocar o banco por um servico externo (Postgres,
Turso). Isso nao e um ajuste: as 341 consultas do sistema sao **sincronas**, e um banco
remoto exige reescrever tudo para assincrono. E um projeto separado.

## Opcao 1: servidor com Docker (recomendado)

Funciona em VPS, Maquina virtual, Railway, Fly.io, Render com disco - qualquer lugar que
rode um container com volume.

```bash
# no servidor, dentro da pasta do projeto
echo "BDE_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" > .env
docker compose up -d --build

# primeira vez: banco vazio -> carga de dados (ou comece do zero e cadastre o seu)
docker compose exec sistema npm run db:seed
```

O banco fica no volume `dados` (montado em `/dados`), sobrevive a atualizacoes da imagem
e nao entra no container. Para atualizar depois de mudar o codigo:
`docker compose up -d --build`.

### HTTPS e dominio

Na frente do container, um proxy com certificado automatico. Com Caddy e um dominio
apontado para o servidor, o `Caddyfile` inteiro e:

```
sistema.seudominio.com.br {
    reverse_proxy 127.0.0.1:3000
    encode gzip
}
```

Sem dominio, ainda da para testar pelo IP (`http://IP:3000`) - so nao fica criptografado,
o que importa porque a senha do login trafega nessa conexao.

### Backup

O banco e um arquivo: backup e copia-lo com o WAL aplicado.

```bash
node scripts/backup-banco.mjs --destino=/backups --manter=30
```

No container, agende no cron do servidor (3h da manha, por exemplo):

```
0 3 * * * docker compose exec -T sistema node scripts/backup-banco.mjs --destino=/backups --manter=30
```

Para restaurar: pare o sistema, copie o backup escolhido para o caminho de
`BDE_DB_PATH` (`/dados/banho.db`), apague um eventual `.db-wal` e suba de novo.

## Opcao 2: a propria maquina da loja

E o cenario mais simples e o que tem menos pecas: o sistema roda no PC da loja
(`npm run dev`, ou `npm run build && npm start` para producao) e o celular acessa pelo
IP da maquina na rede (`http://192.168.0.10:3000`).

Para acessar de fora da loja sem abrir porta no roteador, um tunel resolve:

```bash
# Cloudflare Tunnel sem conta (link temporario, HTTPS)
npx cloudflared tunnel --url http://localhost:3000
```

Cuidado com o tunel: o link fica publico na internet, protegido apenas pela tela de
login. **Troque as senhas de demonstracao antes de expor** (`/configuracoes/usuarios`)
e nunca deixe o PDV aberto num link publico.

## Apresentar ao cliente (sem servidor)

Para mostrar o sistema sem publicar nada, existe um modo apresentacao que roda em build
de producao (sem a barra de desenvolvimento do Next), com um banco de demonstracao
separado dos seus dados:

```bash
npm run apresentar                 # recria o banco de demonstracao e sobe em http://localhost:3000
npm run apresentar -- --sem-reset  # continua de onde parou (nao apaga o que foi feito)
npm run apresentar -- --porta=3200 # outra porta
```

Ao subir, o terminal mostra o endereco para o computador e o endereco da rede (para o
celular), o estado inicial do caixa e as dicas do roteiro. Rodar de novo restaura o
banco limpo, entao a apresentacao nunca comeca com dados estragados.

Se a apresentacao for remota (cliente em outro lugar), publique com um tunel enquanto a
sessao durar:

```bash
npx cloudflared tunnel --url http://localhost:3000
```

O endereco gerado e aleatorio (por exemplo `https://count-itself-organised-drives.trycloudflare.com`)
e muda a cada vez que o tunel sobe. Para conferir o que o cliente vai ver, com o tunel no
ar:

```bash
npm run verificar:link --  # precisa de BASE no ambiente
BASE=https://xxxx.trycloudflare.com npm run verificar:link
```

O script entra pela tela de login do endereco publico, percorre caixa, produtos, vendas,
relatorios e estoque, faz uma venda pelo PDV e salva prints em
`%LOCALAPPDATA%\Temp\bde-ui\link-publico`.

Cuidados ao expor o link publico:

- o tunel gratuito nao tem garantia de disponibilidade: e para apresentar, nao para operar;
- o endereco e aleatorio, mas nao e secreto: quem tiver o link chega na tela de login, e a
  tela mostra os acessos de demonstracao. Por isso o modo apresentacao usa o banco
  `data/apresentacao.db`, descartavel - seus dados reais em `data/banho.db` nao entram;
- encerre o tunel (Ctrl+C) no fim da apresentacao.

## Resumo

| Onde | Serve para | Banco |
|---|---|---|
| Vercel (serverless) | nao serve para operar | somente leitura, sem disco |
| VPS com Docker | operacao real, acesso de qualquer lugar | volume com backup |
| PC da loja (+ tunel) | operacao real no balcao | arquivo local, backup por copia |
