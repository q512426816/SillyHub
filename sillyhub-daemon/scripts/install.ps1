# install.ps1 -- SillyHub daemon installer (Windows PowerShell).
#
# author: qinyi
# created_at: 2026-07-14
#
# Usage:
#   irm <SERVER>/daemon/install.ps1 | iex
#   $server="<url>"; $apiKey="<key>"; irm <SERVER>/daemon/install.ps1 | iex
#
# Features (aligned with sillyhub-daemon/scripts/install.sh):
#   1. Detect node >= 20 (prompt install if missing)
#   2. Fetch <SERVER>/daemon/latest.json for latest version + download URL
#   3. Download sillyhub-daemon.js + mcp-server.js to %USERPROFILE%\.sillyhub\daemon\bin\
#   4. Create wrapper %USERPROFILE%\.sillyhub\daemon\bin\sillyhub-daemon.cmd
#      (node.exe absolute path fallback + %~dp0 relative bundle)
#   5. Write config.json (server_url embedded + new runtime_id)
#   6. Add bin dir to user PATH (setx, idempotent)
#   6.5 Add ~/.sillyhub to Windows Defender exclusions (best-effort, ql-20260904-016)
#   7. Verify sillyhub-daemon --version
#   8. Print next steps (no auto start)
#
# About ExecutionPolicy:
#   `irm | iex` runs script content in current session, bypassing ExecutionPolicy Restricted
#   （Restricted 只拦 .ps1 文件加载，不拦管道执行）。如果环境仍拦截
#   (e.g. group policy), run this first:
#       Set-ExecutionPolicy -Scope Process Bypass
#
# SERVER_URL resolution:
#   Script uses `{{SERVER_URL}}` placeholder, replaced by backend dist_router.
#   Override with $env:SILLYHUB_SERVER_URL="<url>" before iex, or set
#   $server="<url>" variable before iex.

#Requires -Version 5.1

# Force UTF-8 output: PowerShell defaults to OEM/GBK, garbling Chinese in redirects
# Setting UTF-8 + chcp 65001 ensures Write-Host displays correctly everywhere.
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
try { chcp 65001 > $null } catch {}

# -- SERVER_URL resolution (priority high to low)─────────────────────────────────────────
#   a. $server variable (set before iex)
#   b. $env:SILLYHUB_SERVER_URL
#   c. Built-in {{SERVER_URL}} placeholder (replaced by backend dist_router)
$defaultServerUrl = '{{SERVER_URL}}'
if ($server) {
  $script:SERVER_URL = $server
} elseif ($env:SILLYHUB_SERVER_URL) {
  $script:SERVER_URL = $env:SILLYHUB_SERVER_URL
} else {
  $script:SERVER_URL = $defaultServerUrl
}
# Strip trailing slash
$script:SERVER_URL = $script:SERVER_URL.TrimEnd('/')

# -- Directories / filenames ────────────────────────────────────────────────────────────
$script:INSTALL_DIR = Join-Path $env:USERPROFILE '.sillyhub\daemon'
$script:BIN_DIR     = Join-Path $script:INSTALL_DIR 'bin'
$script:BUNDLE_NAME = 'sillyhub-daemon.js'
$script:MCP_NAME    = 'mcp-server.js'
$script:WRAPPER_NAME = 'sillyhub-daemon.cmd'
$script:NODE_BIN    = $null

# -- Logging ──────────────────────────────────────────────────────────────────────
function Write-Info { param([string]$Msg) Write-Host "[info]  $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[ok]    $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[warn]  $Msg" -ForegroundColor Yellow }
function Die {
  param([string]$Msg)
  Write-Host "[error] $Msg" -ForegroundColor Red
  exit 1
}

# -- 1. Detect node >= 20 ─────────────────────────────────────────────────────────
# Search order:
#   1a. Get-Command node (current session PATH)
#   1b. Common install paths
#   1c. Registry PATH (HKLM + HKCU) fallback
#       (most reliable when current PATH not refreshed / nvm switched)
function Test-NodeVersion {
  # 1a. Standard PATH lookup
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    $script:NODE_BIN = $cmd.Source
  }

  # 1b. Common Windows install paths
  if (-not $script:NODE_BIN) {
    $candidates = @(
      "$env:ProgramFiles\nodejs\node.exe",
      "${env:ProgramFiles(x86)}\nodejs\node.exe",
      "$env:LOCALAPPDATA\nvm4w\nodejs\node.exe",
      "$env:APPDATA\nvm4w\nodejs\node.exe",
      "$env:USERPROFILE\nvm4w\nodejs\node.exe"
    )
    foreach ($p in $candidates) {
      if ($p -and (Test-Path -LiteralPath $p)) {
        $script:NODE_BIN = $p
        Write-Info "Found node (path scan): $($script:NODE_BIN)"
        break
      }
    }
  }

  # 1c. Registry PATH fallback
  # When current session PATH lacks node (1a/1b miss) but registry has it:
  # read from registry. Does not depend on current process PATH.
  if (-not $script:NODE_BIN) {
    $found = $null
    $regPaths = @(
      'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment',
      'HKCU:\Environment'
    )
    foreach ($regKey in $regPaths) {
      if ($found) { break }
      try {
        $envVal = (Get-ItemProperty -Path $regKey -Name PATH -ErrorAction SilentlyContinue).PATH
        if (-not $envVal) { continue }
        foreach ($p in ($envVal -split ';')) {
          if ($p -and (Test-Path -LiteralPath (Join-Path $p 'node.exe'))) {
            $found = Join-Path $p 'node.exe'
            break
          }
        }
      } catch {
        # Registry read failed, continue silently
      }
    }
    if ($found) {
      $script:NODE_BIN = $found
      Write-Info "Found node (registry PATH): $($script:NODE_BIN)"
    }
  }

  # node not found
  if (-not $script:NODE_BIN) {
    Write-Warn "node not found. Please install Node.js >= 20:"
    Write-Host "  Option 1 (nvm-windows): https://github.com/coreybutler/nvm-windows/releases"
    Write-Host "  Option 2 (official):    https://nodejs.org/en/download"
    Die "node is required. Install node and re-run this script."
  }

  # Version check (>= 20)
  try {
    $verOut = & $script:NODE_BIN -p 'process.versions.node' 2>$null
    $major = [int]($verOut.ToString().Split('.')[0])
  } catch {
    $major = 0
  }
  if ($major -lt 20) {
    $vOut = (& $script:NODE_BIN -v 2>$null).ToString()
    Die "node version too old (v$vOut), requires >= 20."
  }
  $vOut = (& $script:NODE_BIN -v 2>$null).ToString()
  Write-Ok "node v$vOut OK (>= 20)"
}

# -- 2. Fetch latest.json ──────────────────────────────────────────────────────
function Get-LatestManifest {
  $url = "$($script:SERVER_URL)/daemon/latest.json"
  Write-Info "Fetching latest version: $url"
  $script:LATEST_VERSION = 'unknown'
  $script:DOWNLOAD_URL = "$($script:SERVER_URL)/daemon/latest/$($script:BUNDLE_NAME)"
  try {
    $resp = Invoke-RestMethod -Uri $url -ErrorAction Stop
    if ($resp.version) { $script:LATEST_VERSION = $resp.version }
    if ($resp.downloadUrl) {
      $dl = $resp.downloadUrl
      if ($dl -notmatch '^https?:') {
        # Relative path -> prepend SERVER_URL
        $script:DOWNLOAD_URL = "$($script:SERVER_URL)$dl"
      } else {
        $script:DOWNLOAD_URL = $dl
      }
    }
  } catch {
    Write-Warn "Cannot fetch latest.json ($url), using default download path."
    return
  }
  Write-Ok "Latest version: $($script:LATEST_VERSION)"
  Write-Ok "Download URL: $($script:DOWNLOAD_URL)"
}

# -- 3. Download bundle ────────────────────────────────────────────────────────────
function Download-Bundle {
  if (-not (Test-Path -LiteralPath $script:BIN_DIR)) {
    New-Item -ItemType Directory -Path $script:BIN_DIR -Force | Out-Null
  }

  # sillyhub-daemon.js (main bundle)
  $bundlePath = Join-Path $script:BIN_DIR $script:BUNDLE_NAME
  Write-Info "Downloading $($script:BUNDLE_NAME) -> $bundlePath"
  try {
    Invoke-WebRequest -Uri $script:DOWNLOAD_URL -OutFile $bundlePath -UseBasicParsing -ErrorAction Stop
  } catch {
    Die "Download failed: $($script:DOWNLOAD_URL)"
  }
  Write-Ok "$($script:BUNDLE_NAME) downloaded"

  # mcp-server.js（D-003：team 主 agent MCP server 子进程入口，与 sillyhub-daemon.js
  # Same dir as sillyhub-daemon.js. Used by buildDaemonMcpServerConfig.
  # team 主 agent 注入的 MCP server spawn 失败 → 5 tool 链路断。）
  $mcpUrl = "$($script:SERVER_URL)/daemon/latest/$($script:MCP_NAME)"
  $mcpPath = Join-Path $script:BIN_DIR $script:MCP_NAME
  Write-Info "Downloading $($script:MCP_NAME) -> $mcpPath"
  try {
    Invoke-WebRequest -Uri $mcpUrl -OutFile $mcpPath -UseBasicParsing -ErrorAction Stop
    Write-Ok "$($script:MCP_NAME) downloaded"
  } catch {
    Write-Warn "$($script:MCP_NAME) 下载失败（$mcpUrl）——team 主 agent MCP 注入将不可用"
  }
}

# -- 4. Create .cmd wrapper ──────────────────────────────────────────────────────
# Write sillyhub-daemon.cmd:
#   @echo off + node.exe absolute path fallback + %~dp0 relative bundle
#   Windows .cmd must be CRLF: Write-Output defaults to LF, use -NoNewline + `r`n.
function Write-CmdWrapper {
  $cmdPath = Join-Path $script:BIN_DIR $script:WRAPPER_NAME
  Write-Info "Creating wrapper: $cmdPath"

  $nodeDir  = Split-Path $script:NODE_BIN -Parent
  $nodeExe  = Join-Path $nodeDir 'node.exe'

  # Build .cmd content (CRLF line endings)
  $lines = @(
    '@echo off',
    'REM Auto-generated by SillyHub install.ps1 - do not edit.',
    'REM bundle path is %~dp0 self-relative; node uses absolute path with PATH fallback',
    "if exist `"$nodeExe`" (",
    "  `"$nodeExe`" `"%~dp0$($script:BUNDLE_NAME)`" %*",
    ') else (',
    "  node `"%~dp0$($script:BUNDLE_NAME)`" %*",
    ')'
  )
  $content = ($lines -join "`r`n") + "`r`n"
  Set-Content -LiteralPath $cmdPath -Value $content -NoNewline -Encoding ASCII

  Write-Ok ".cmd wrapper created: $cmdPath"
}

# -- 5. Save config.json ──────────────────────────────────────────────────────
# Fields aligned with install.sh save_server_url:
#   server_url / token / api_key / runtime_id / profile / poll_interval /
#   heartbeat_interval / max_concurrent_tasks / log_level / default_timeout_seconds
function Save-Config {
  $configFile = Join-Path $script:INSTALL_DIR 'config.json'
  if (-not (Test-Path -LiteralPath $script:INSTALL_DIR)) {
    New-Item -ItemType Directory -Path $script:INSTALL_DIR -Force | Out-Null
  }

  if (Test-Path -LiteralPath $configFile) {
    # Exists -> merge (only overwrite server_url, keep other fields)
    Write-Info "Updating server_url in config.json"
    try {
      $raw = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8
      $c = $raw | ConvertFrom-Json
      $c.server_url = $script:SERVER_URL
      $c | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configFile -Encoding UTF8
    } catch {
      Write-Warn "config.json update failed (permission?), server_url not saved"
      return
    }
  } else {
    # New file (aligned with install.sh fields + defaults)
    Write-Info "Creating config.json (server_url=$($script:SERVER_URL))"
    $c = [ordered]@{
      server_url             = $script:SERVER_URL
      token                  = $null
      api_key                = $null
      runtime_id             = [guid]::NewGuid().ToString()
      profile                = 'default'
      poll_interval          = 30
      heartbeat_interval     = 15
      max_concurrent_tasks   = 5
      log_level              = 'info'
      default_timeout_seconds = 1800
    }
    try {
      $c | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configFile -Encoding UTF8
    } catch {
      Write-Warn "config.json creation failed, server_url not saved"
      return
    }
  }
  Write-Ok "server_url saved to config.json"
}

# -- 6. Add to PATH (setx, idempotent)───────────────────────────────────────────────────
# Add bin dir to user-level PATH (setx persists, new terminals pick it up).
# Idempotent: checks user PATH first, skips if already present.
function Set-Path {
  $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
  $binDirWin = $script:BIN_DIR

  # Already in current session PATH?
  if ($env:PATH -split ';' -contains $binDirWin) {
    Write-Ok "PATH already contains $binDirWin"
  } else {
    # Add to current session (for remaining install steps)
    $env:PATH = "$binDirWin;$env:PATH"
  }

  # Already in user registry PATH? (idempotent)
  if ($userPath -and (($userPath -split ';') -contains $binDirWin)) {
    Write-Ok "User PATH already contains $binDirWin (skipping setx)"
  } else {
    Write-Info "Adding $binDirWin to user PATH"
    $newPath = if ($userPath) { "$userPath;$binDirWin" } else { $binDirWin }
    try {
      setx PATH $newPath | Out-Null
      Write-Ok "User PATH updated (new terminals will pick it up)"
    } catch {
      Write-Warn "setx PATH failed (permission?), manually add $binDirWin to user PATH"
    }
  }
}

# -- 6.5 Windows Defender 排除目录（best-effort）──────────────────────────────────
# 把 ~/.sillyhub 加入 Defender 排除（ql-20260904-016：spec 全量同步逐文件写盘在
# 实机被杀软逐文件扫描放大 ~8ms/文件，数千文件累计数十秒，是会话首响延迟大头之一）。
# 需管理员权限：当前会话不足时自动 UAC 提权尝试一次（用户可拒绝）；任何失败只
# 提示手动命令，绝不阻塞安装主流程。无 Defender（第三方杀软/精简系统）静默跳过。
function Set-DefenderExclusion {
  $exclDir = Join-Path $env:USERPROFILE '.sillyhub'
  if (-not (Get-Command Add-MpPreference -ErrorAction SilentlyContinue)) {
    return
  }
  try {
    Add-MpPreference -ExclusionPath $exclDir -ErrorAction Stop
    Write-Ok "Defender exclusion added: $exclDir"
    return
  } catch {
    # 当前会话非管理员 → 落到下方 UAC 提权尝试
  }
  $inner = "Add-MpPreference -ExclusionPath '$exclDir'"
  try {
    $proc = Start-Process powershell -Verb RunAs -WindowStyle Hidden -PassThru `
      -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command', $inner
    # UAC 应答带 120s 超时（WaitForExit(ms)）：无人值守安装（CI / irm|iex 后离开）
    # 不因弹窗无人确认而无限挂起——超时先继续安装，用户稍后批准则排除仍会生效。
    if ($proc.WaitForExit(120000)) {
      if ($proc.ExitCode -eq 0) {
        Write-Ok "Defender exclusion added (elevated): $exclDir"
      } else {
        Write-Warn "Defender exclusion failed (elevated exit=$($proc.ExitCode))"
        Write-Host "  手动执行（管理员 PowerShell）: Add-MpPreference -ExclusionPath '$exclDir'"
      }
    } else {
      Write-Warn "UAC 确认超时（120s），安装先行继续；稍后批准弹窗则排除仍会生效。"
      Write-Host "  或手动执行（管理员 PowerShell）: Add-MpPreference -ExclusionPath '$exclDir'"
    }
  } catch {
    Write-Warn "Defender exclusion needs admin (UAC declined?), 手动执行（管理员 PowerShell）:"
    Write-Host "  Add-MpPreference -ExclusionPath '$exclDir'"
  }
}

# -- 7. Verify --version ─────────────────────────────────────────────────────────
function Invoke-Verify {
  Write-Info "Verifying sillyhub-daemon --version"
  $bundlePath = Join-Path $script:BIN_DIR $script:BUNDLE_NAME
  try {
    $verOut = & $script:NODE_BIN $bundlePath --version 2>$null
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "sillyhub-daemon $($verOut.ToString().Trim()) OK"
    } else {
      Write-Warn "Verification failed, bundle may need PATH to run."
      Write-Warn "请手动执行: `"$($script:NODE_BIN)`" `"$bundlePath`" --version"
    }
  } catch {
    Write-Warn "验证失败，bundle 可能需要 PATH 配置后才能运行。"
    Write-Warn "请手动执行: `"$($script:NODE_BIN)`" `"$bundlePath`" --version"
  }
}

# -- Main ────────────────────────────────────────────────────────────────────
function Main {
  Write-Info "SillyHub daemon installer"
  Write-Info "Server: $($script:SERVER_URL)"
  Test-NodeVersion
  Get-LatestManifest
  Download-Bundle
  Write-CmdWrapper
  Save-Config
  Set-Path
  Set-DefenderExclusion
  Invoke-Verify

  Write-Host ""
  Write-Ok "Installation complete!"
  Write-Host "  Server URL saved: $($script:SERVER_URL)"
  Write-Host "  Next: sillyhub-daemon start --api-key <your API key>"
  Write-Host "  (server_url in config.json, no need for --server)"
  Write-Host "  (PATH active in new terminals; or already added to current session)"
  Write-Host "  Autostart (optional): sillyhub-daemon autostart enable --server $($script:SERVER_URL) --api-key <your API key>"
  Write-Host ""

  # DG-04: autostart is provided by the CLI `autostart` subcommand; the installer
  # does not register any autostart itself (only prints the hint above).
}

Main
