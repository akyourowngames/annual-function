# tunnel.ps1 — start the tunnel, or re-point Telegram at it.
#
# Plain-English version: Telegram needs a public address to send messages to.
# A quick tunnel gives you a new random address every time it starts, so the
# webhook has to be told the new one. This script does that for you.
#
# Run it with  tunnel.bat  (double-click), or:
#   pwsh -File tunnel.ps1
#
# Secrets are read from web/.env.local — never written in this file.

$ErrorActionPreference = 'Stop'

# --- locate the project ------------------------------------------------------

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile   = Join-Path $scriptDir 'web\.env.local'
$cfExe     = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'

function Read-DotEnv([string]$path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  foreach ($line in Get-Content $path) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $map[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
  }
  return $map
}

$cfg = Read-DotEnv $envFile
$token  = $cfg['TELEGRAM_BOT_TOKEN']
$secret = $cfg['TELEGRAM_WEBHOOK_SECRET']

function Write-Head([string]$text) {
  Write-Host ''
  Write-Host ('  ' + $text) -ForegroundColor Cyan
  Write-Host ('  ' + ('-' * $text.Length)) -ForegroundColor DarkGray
}

function Get-WebhookInfo {
  if (-not $token) { return $null }
  try {
    $r = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo" -TimeoutSec 20
    return $r.result
  } catch { return $null }
}

function Set-Webhook([string]$url) {
  if (-not $token) { Write-Host '  No TELEGRAM_BOT_TOKEN in web/.env.local' -ForegroundColor Red; return $false }
  if (-not $secret) { Write-Host '  No TELEGRAM_WEBHOOK_SECRET in web/.env.local' -ForegroundColor Red; return $false }
  $full = $url.TrimEnd('/') + '/api/telegram/webhook'
  try {
    $r = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/setWebhook" -Method Post `
      -Body @{ url = $full; secret_token = $secret } -TimeoutSec 30
    if ($r.ok) {
      Write-Host "  Telegram now sends to:" -ForegroundColor Green
      Write-Host "    $full" -ForegroundColor White
      return $true
    }
    Write-Host "  Telegram refused: $($r.description)" -ForegroundColor Red
    return $false
  } catch {
    Write-Host "  Could not reach Telegram: $($_.Exception.Message)" -ForegroundColor Red
    return $false
  }
}

function Show-Status {
  Write-Head 'Status'
  $w = Get-WebhookInfo
  if (-not $w) { Write-Host '  Could not read webhook info (check your token).' -ForegroundColor Red; return }
  Write-Host "  Telegram sends to : $($w.url)"
  if ($w.last_error_message) {
    Write-Host "  Last error        : $($w.last_error_message)" -ForegroundColor Red
  } else {
    Write-Host "  Last error        : none" -ForegroundColor Green
  }
  if ($w.pending_update_count -gt 0) {
    Write-Host "  Messages waiting  : $($w.pending_update_count)  <- they are stuck" -ForegroundColor Yellow
  } else {
    Write-Host "  Messages waiting  : 0" -ForegroundColor Green
  }

  # Is the app up locally?
  try {
    $null = Invoke-WebRequest -Uri 'http://localhost:3000/api/event' -UseBasicParsing -TimeoutSec 5
    Write-Host "  Local app (3000)  : running" -ForegroundColor Green
  } catch {
    Write-Host "  Local app (3000)  : NOT running  -> run 'npm run dev' in web/" -ForegroundColor Red
  }
}

function Start-TunnelAndWire {
  if (-not (Test-Path $cfExe)) {
    Write-Host "  cloudflared not found at $cfExe" -ForegroundColor Red
    return
  }
  try {
    $null = Invoke-WebRequest -Uri 'http://localhost:3000/api/event' -UseBasicParsing -TimeoutSec 5
  } catch {
    Write-Host '  The website is not running on port 3000.' -ForegroundColor Red
    Write-Host '  Open another window, run:  cd web   then   npm run dev' -ForegroundColor Yellow
    Write-Host '  Then run this script again.' -ForegroundColor Yellow
    return
  }

  $log = Join-Path $env:TEMP ("cf-" + [guid]::NewGuid().ToString('N') + ".log")
  Write-Head 'Starting tunnel'
  Write-Host '  Launching cloudflared...'

  $proc = Start-Process -FilePath $cfExe `
    -ArgumentList @('tunnel', '--url', 'http://localhost:3000', '--no-autoupdate') `
    -RedirectStandardError $log -RedirectStandardOutput "$log.out" -PassThru -WindowStyle Hidden

  # cloudflared prints the address a few seconds after starting.
  $url = $null
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 700
    foreach ($f in @($log, "$log.out")) {
      if (Test-Path $f) {
        $m = Select-String -Path $f -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches -ErrorAction SilentlyContinue
        if ($m) {
          $url = $m.Matches[-1].Value
          break
        }
      }
    }
    if ($url) { break }
    if ($proc.HasExited) { break }
  }

  if (-not $url) {
    Write-Host '  Could not get a tunnel address. cloudflared said:' -ForegroundColor Red
    foreach ($f in @($log, "$log.out")) {
      if (Test-Path $f) { Get-Content $f -Tail 12 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray } }
    }
    return
  }

  Write-Host ''
  Write-Host "  Your public address:" -ForegroundColor Green
  Write-Host "    $url" -ForegroundColor White
  Write-Host ''
  Start-Sleep -Seconds 2

  if (Set-Webhook $url) {
    Start-Sleep -Seconds 2
    Show-Status
  }

  Write-Head 'Tunnel is running'
  Write-Host '  Leave this window open. Message your bot to test.' -ForegroundColor Yellow
  Write-Host '  Press Ctrl+C here to stop the tunnel.' -ForegroundColor DarkGray
  Write-Host ''
  try { Wait-Process -Id $proc.Id } catch { }
  Write-Host '  Tunnel stopped.' -ForegroundColor DarkGray
}

$urlFromArgs = $args[0]

# --- argument mode: just wire the given URL ---------------------------------
if ($urlFromArgs) {
  Write-Head 'Pointing Telegram at a given address'
  if (Set-Webhook $urlFromArgs) { Start-Sleep -Seconds 2; Show-Status }
  Write-Host ''
  exit
}

# --- menu -------------------------------------------------------------------
$clear = $true
while ($true) {
  if ($clear) { Clear-Host }
  $clear = $true
  Write-Host ''
  Write-Host '  ================================================' -ForegroundColor Cyan
  Write-Host '   Telegram tunnel helper' -ForegroundColor Cyan
  Write-Host '  ================================================' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '   1  Start tunnel + connect Telegram   (normal use)'
  Write-Host '   2  I already have a URL - connect it'
  Write-Host '   3  Check status (is it working?)'
  Write-Host '   4  Test the bot by sending a message'
  Write-Host '   5  Quit'
  Write-Host ''
  $choice = Read-Host '  Pick 1-5'

  switch ($choice.Trim()) {
    '1' { Start-TunnelAndWire; Write-Host ''; Read-Host '  Press Enter for the menu' | Out-Null }
    '2' {
      Write-Head 'Paste your tunnel address'
      Write-Host '  Example: https://something-words-here.trycloudflare.com' -ForegroundColor DarkGray
      $u = Read-Host '  URL'
      if ($u) { if (Set-Webhook $u) { Start-Sleep -Seconds 2; Show-Status } }
      Write-Host ''; Read-Host '  Press Enter for the menu' | Out-Null
    }
    '3' { Show-Status; Write-Host ''; Read-Host '  Press Enter for the menu' | Out-Null }
    '4' {
      Write-Head 'Test the bot'
      $chat = Read-Host '  Your Telegram chat id (press Enter for 7280190750)'
      if (-not $chat) { $chat = '7280190750' }
      try {
        $r = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/sendMessage" -Method Post `
          -Body @{ chat_id = $chat; text = 'Test from the tunnel helper - if you can read this, the bot works.' } -TimeoutSec 30
        if ($r.ok) { Write-Host '  Sent. Check your Telegram.' -ForegroundColor Green }
        else { Write-Host "  Telegram said: $($r.description)" -ForegroundColor Red }
      } catch { Write-Host "  Failed: $($_.Exception.Message)" -ForegroundColor Red }
      Write-Host ''; Read-Host '  Press Enter for the menu' | Out-Null
    }
    '5' { return }
    default { Write-Host '  Please type 1, 2, 3, 4 or 5.' -ForegroundColor Yellow; Start-Sleep -Seconds 1; $clear = $false }
  }
}
