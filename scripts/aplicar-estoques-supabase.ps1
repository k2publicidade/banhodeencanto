# Aplica o schema dos ESTOQUES SEPARADOS no Supabase (banco de producao) e,
# opcionalmente, separa o estoque que esta todo num local entre loja e galpao.
#
# Executar interativamente: pede a senha do banco sem exibi-la e nunca grava a
# URI em arquivo (mesmo padrao do scripts/configurar-banco-vercel.ps1).
#
#   .\scripts\aplicar-estoques-supabase.ps1              -> aplica o schema e mostra
#                                                          a simulacao da divisao
#   .\scripts\aplicar-estoques-supabase.ps1 -Dividir     -> aplica e ja separa 60/40
#   .\scripts\aplicar-estoques-supabase.ps1 -Dividir -Percentual 70
#
# Nada e apagado: o schema e idempotente e a divisao sai por transferencias, com
# conferencia de que o total de pecas continua o mesmo.
param(
  [switch]$Dividir,
  [int]$Percentual = 60,
  # Opcional: para automacao/teste com um banco local. Sem ele, a senha e pedida
  # no terminal (o normal, para nao deixar credencial em historico).
  [string]$DatabaseUrl = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Push-Location $projectDirectory
try {
  if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    $securePassword = Read-Host 'Senha atual do banco Supabase (nao sera exibida)' -AsSecureString
    $plainPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
    if ([string]::IsNullOrWhiteSpace($plainPassword)) { throw 'Senha vazia.' }
    $encodedPassword = [uri]::EscapeDataString($plainPassword)
    $env:DATABASE_URL = "postgresql://postgres.arrasckigyaryfjwfgjb:$encodedPassword@aws-1-us-east-2.pooler.supabase.com:6543/postgres?uselibpqcompat=true&sslmode=require"
    $plainPassword = $null
    $encodedPassword = $null
  } else {
    $env:DATABASE_URL = $DatabaseUrl
  }

  Write-Host ''
  Write-Host '1) Aplicando o schema (tabelas transferencias / views de estoque)...'
  node scripts/estoque-dividir-postgres.mjs --so-schema
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao aplicar o schema no Supabase.' }

  Write-Host ''
  if ($Dividir) {
    Write-Host "2) Separando o estoque ($Percentual% para o galpao)..."
    node scripts/estoque-dividir-postgres.mjs --confirmar --refazer --percentual=$Percentual
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao separar o estoque.' }
    Write-Host ''
    Write-Host 'Pronto: schema aplicado e estoque separado entre loja e galpao.'
  } else {
    Write-Host '2) Simulacao da divisao (nada gravado):'
    node scripts/estoque-dividir-postgres.mjs --percentual=$Percentual
    if ($LASTEXITCODE -ne 0) { throw 'Falha na simulacao da divisao.' }
    Write-Host ''
    Write-Host "Schema aplicado. Para separar o estoque de verdade, rode de novo com:"
    Write-Host "  .\scripts\aplicar-estoques-supabase.ps1 -Dividir -Percentual $Percentual"
  }
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  if (Get-Variable -Name plainPassword -Scope Local -ErrorAction SilentlyContinue) { $plainPassword = $null }
  if (Get-Variable -Name securePassword -Scope Local -ErrorAction SilentlyContinue) { $securePassword = $null }
  Pop-Location
}
