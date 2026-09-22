# Executar interativamente: pede a senha sem exibi-la nem gravar a URI em arquivo.
# Projeto Supabase confirmado pelo proprietario: arrasckigyaryfjwfgjb.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Push-Location $projectDirectory
try {
  $securePassword = Read-Host 'Senha atual do banco Supabase (nao sera exibida)' -AsSecureString
  $plainPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
  if ([string]::IsNullOrWhiteSpace($plainPassword)) { throw 'Senha vazia.' }
  $encodedPassword = [uri]::EscapeDataString($plainPassword)
  $env:DATABASE_URL = "postgresql://postgres.arrasckigyaryfjwfgjb:$encodedPassword@aws-1-us-east-2.pooler.supabase.com:6543/postgres?uselibpqcompat=true&sslmode=require"
  $plainPassword = $null
  $encodedPassword = $null
  node scripts/migrar-sqlite-postgres.mjs --confirmar
  if ($LASTEXITCODE -ne 0) { throw 'A migracao falhou; a variavel nao foi enviada a Vercel.' }
  $env:DATABASE_URL | npx vercel env add DATABASE_URL production --sensitive
  if ($LASTEXITCODE -ne 0) { throw 'A migracao passou, mas nao foi possivel configurar DATABASE_URL na Vercel.' }
  Write-Host 'Banco migrado e DATABASE_URL configurada na Vercel.'
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  $plainPassword = $null
  $securePassword = $null
  Pop-Location
}
