# install.ps1 -- SillyHub daemon 一键安装脚本（Windows PowerShell 版）。
#
# author: qinyi
# created_at: 2026-07-14
#
# 用法（用户侧）：
#   irm <SERVER>/daemon/install.ps1 | iex
#   $server="<url>"; $apiKey="<key>"; irm <SERVER>/daemon/install.ps1 | iex
#
# 功能（对齐 sillyhub-daemon/scripts/install.sh）：
#   1. 检测 node >= 20（缺失则提示安装并退出）
#   2. 拉取 <SERVER>/daemon/latest.json 获取最新版本号 + 下载 URL
#   3. 下载 sillyhub-daemon.js + mcp-server.js 到 %USERPROFILE%\.sillyhub\daemon\bin\
#   4. 创建 wrapper %USERPROFILE%\.sillyhub\daemon\bin\sillyhub-daemon.cmd
#      （node.exe 绝对路径兜底 + %~dp0 自相对 bundle）
#   5. 写 config.json（server_url 内嵌 + 新 runtime_id）
#   6. 把 bin 目录加进用户 PATH（setx，幂等）
#   7. 验证 sillyhub-daemon --version
#   8. 打印下一步提示（不自动 start）
#
# 关于 ExecutionPolicy：
#   `irm | iex` 是在当前会话执行脚本内容，不受 ExecutionPolicy Restricted 限制
#   （Restricted 只拦 .ps1 文件加载，不拦管道执行）。如果环境仍拦截
#   （如组策略强制），先在会话内执行：
#       Set-ExecutionPolicy -Scope Process Bypass
#
# SERVER_URL 说明：
#   脚本内用 `{{SERVER_URL}}` 占位，由后端 dist_router 在分发时动态替换为真实地址。
#   用户也可在 iex 前先 $env:SILLYHUB_SERVER_URL="<url>" 覆盖，或在 iex 前
#   $server="<url>" 变量传入。

#Requires -Version 5.1

# 强制 UTF-8 输出：PowerShell 默认按 OEM/GBK 输出，重定向（git-bash/CI 日志/管道捕获）
# 时中文变乱码。设 UTF-8 + chcp 65001 让 Write-Host 中文在所有场景正常显示。
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
try { chcp 65001 > $null } catch {}

# ── SERVER_URL 推导（优先级从高到低）─────────────────────────────────────────
#   a. $server 变量（用户在 iex 前赋值）
#   b. $env:SILLYHUB_SERVER_URL
#   c. 内置 {{SERVER_URL}} 占位（后端 dist_router 动态替换）
$defaultServerUrl = '{{SERVER_URL}}'
if ($server) {
  $script:SERVER_URL = $server
} elseif ($env:SILLYHUB_SERVER_URL) {
  $script:SERVER_URL = $env:SILLYHUB_SERVER_URL
} else {
  $script:SERVER_URL = $defaultServerUrl
}
# 去掉末尾斜杠
$script:SERVER_URL = $script:SERVER_URL.TrimEnd('/')

# ── 目录 / 文件名 ────────────────────────────────────────────────────────────
$script:INSTALL_DIR = Join-Path $env:USERPROFILE '.sillyhub\daemon'
$script:BIN_DIR     = Join-Path $script:INSTALL_DIR 'bin'
$script:BUNDLE_NAME = 'sillyhub-daemon.js'
$script:MCP_NAME    = 'mcp-server.js'
$script:WRAPPER_NAME = 'sillyhub-daemon.cmd'
$script:NODE_BIN    = $null

# ── 日志 ──────────────────────────────────────────────────────────────────────
function Write-Info { param([string]$Msg) Write-Host "[info]  $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[ok]    $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[warn]  $Msg" -ForegroundColor Yellow }
function Die {
  param([string]$Msg)
  Write-Host "[error] $Msg" -ForegroundColor Red
  exit 1
}

# ── 1. 检测 node >= 20 ─────────────────────────────────────────────────────────
# 查找顺序：
#   1a. Get-Command node（当前会话 PATH）
#   1b. 常见安装路径直查
#   1c. 注册表 PATH（HKLM Session Manager\Environment + HKCU Environment）兜底
#       （当前进程 PATH 未刷新 / nvm 切换等场景，读注册表是最权威的 node 查找方式）
function Test-NodeVersion {
  # 1a. 标准 PATH 查找
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    $script:NODE_BIN = $cmd.Source
  }

  # 1b. 常见 Windows 安装路径直查
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
        Write-Info "找到 node（路径探测）: $($script:NODE_BIN)"
        break
      }
    }
  }

  # 1c. 注册表 PATH 兜底
  # 当当前 PowerShell 会话的 PATH 不含 node（1a/1b 都查不到）但系统注册表配了
  # node 时，从这里救。读注册表不依赖当前进程 PATH。
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
        # 注册表读失败静默继续
      }
    }
    if ($found) {
      $script:NODE_BIN = $found
      Write-Info "找到 node（注册表 PATH）: $($script:NODE_BIN)"
    }
  }

  # 未找到 node
  if (-not $script:NODE_BIN) {
    Write-Warn "未检测到 node。请先安装 Node.js >= 20："
    Write-Host "  方式一（nvm-windows）: https://github.com/coreybutler/nvm-windows/releases"
    Write-Host "  方式二（官方）:        https://nodejs.org/en/download"
    Die "缺少 node，安装中止。装好 node 后重新运行本脚本。"
  }

  # 版本检查（>= 20）
  try {
    $verOut = & $script:NODE_BIN -p 'process.versions.node' 2>$null
    $major = [int]($verOut.ToString().Split('.')[0])
  } catch {
    $major = 0
  }
  if ($major -lt 20) {
    $vOut = (& $script:NODE_BIN -v 2>$null).ToString()
    Die "node 版本过低 (v$vOut)，需要 >= 20。"
  }
  $vOut = (& $script:NODE_BIN -v 2>$null).ToString()
  Write-Ok "node v$vOut 满足要求 (>= 20)"
}

# ── 2. 拉取 latest.json ──────────────────────────────────────────────────────
function Get-LatestManifest {
  $url = "$($script:SERVER_URL)/daemon/latest.json"
  Write-Info "获取最新版本信息: $url"
  $script:LATEST_VERSION = 'unknown'
  $script:DOWNLOAD_URL = "$($script:SERVER_URL)/daemon/latest/$($script:BUNDLE_NAME)"
  try {
    $resp = Invoke-RestMethod -Uri $url -ErrorAction Stop
    if ($resp.version) { $script:LATEST_VERSION = $resp.version }
    if ($resp.downloadUrl) {
      $dl = $resp.downloadUrl
      if ($dl -notmatch '^https?:') {
        # 相对路径 → 拼接 SERVER_URL
        $script:DOWNLOAD_URL = "$($script:SERVER_URL)$dl"
      } else {
        $script:DOWNLOAD_URL = $dl
      }
    }
  } catch {
    Write-Warn "无法获取 latest.json（$url），回退到默认下载路径。"
    return
  }
  Write-Ok "最新版本: $($script:LATEST_VERSION)"
  Write-Ok "下载地址: $($script:DOWNLOAD_URL)"
}

# ── 3. 下载 bundle ────────────────────────────────────────────────────────────
function Download-Bundle {
  if (-not (Test-Path -LiteralPath $script:BIN_DIR)) {
    New-Item -ItemType Directory -Path $script:BIN_DIR -Force | Out-Null
  }

  # sillyhub-daemon.js（主 bundle）
  $bundlePath = Join-Path $script:BIN_DIR $script:BUNDLE_NAME
  Write-Info "下载 $($script:BUNDLE_NAME) -> $bundlePath"
  try {
    Invoke-WebRequest -Uri $script:DOWNLOAD_URL -OutFile $bundlePath -UseBasicParsing -ErrorAction Stop
  } catch {
    Die "下载失败: $($script:DOWNLOAD_URL)"
  }
  Write-Ok "$($script:BUNDLE_NAME) 下载完成"

  # mcp-server.js（D-003：team 主 agent MCP server 子进程入口，与 sillyhub-daemon.js
  # 同目录。buildDaemonMcpServerConfig 的 defaultMcpServerModulePath 据此定位。缺失则
  # team 主 agent 注入的 MCP server spawn 失败 → 5 tool 链路断。）
  $mcpUrl = "$($script:SERVER_URL)/daemon/latest/$($script:MCP_NAME)"
  $mcpPath = Join-Path $script:BIN_DIR $script:MCP_NAME
  Write-Info "下载 $($script:MCP_NAME) -> $mcpPath"
  try {
    Invoke-WebRequest -Uri $mcpUrl -OutFile $mcpPath -UseBasicParsing -ErrorAction Stop
    Write-Ok "$($script:MCP_NAME) 下载完成"
  } catch {
    Write-Warn "$($script:MCP_NAME) 下载失败（$mcpUrl）——team 主 agent MCP 注入将不可用"
  }
}

# ── 4. 创建 .cmd wrapper ──────────────────────────────────────────────────────
# 写 sillyhub-daemon.cmd：
#   @echo off + node.exe 绝对路径兜底（不依赖运行时 PATH 含 node）+ %~dp0 自相对 bundle
#   Windows .cmd 必须 CRLF：Write-Out 默认 LF，用 -NoNewline + `r`n 手拼 CRLF。
function Write-CmdWrapper {
  $cmdPath = Join-Path $script:BIN_DIR $script:WRAPPER_NAME
  Write-Info "创建 wrapper: $cmdPath"

  $nodeDir  = Split-Path $script:NODE_BIN -Parent
  $nodeExe  = Join-Path $nodeDir 'node.exe'

  # 构造 .cmd 内容（CRLF 换行）
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

  Write-Ok ".cmd wrapper 已创建: $cmdPath"
}

# ── 5. 保存 config.json ──────────────────────────────────────────────────────
# 字段集对齐 install.sh save_server_url：
#   server_url / token / api_key / runtime_id / profile / poll_interval /
#   heartbeat_interval / max_concurrent_tasks / log_level / default_timeout_seconds
function Save-Config {
  $configFile = Join-Path $script:INSTALL_DIR 'config.json'
  if (-not (Test-Path -LiteralPath $script:INSTALL_DIR)) {
    New-Item -ItemType Directory -Path $script:INSTALL_DIR -Force | Out-Null
  }

  if (Test-Path -LiteralPath $configFile) {
    # 已存在 → 合并（仅覆盖 server_url，保留其余用户字段）
    Write-Info "更新 config.json 中的 server_url"
    try {
      $raw = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8
      $c = $raw | ConvertFrom-Json
      $c.server_url = $script:SERVER_URL
      $c | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configFile -Encoding UTF8
    } catch {
      Write-Warn "config.json 更新失败（权限？），server_url 未持久化"
      return
    }
  } else {
    # 新建（对齐 install.sh 字段集 + 默认值）
    Write-Info "创建 config.json（server_url=$($script:SERVER_URL)）"
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
      Write-Warn "config.json 创建失败，server_url 未持久化"
      return
    }
  }
  Write-Ok "server_url 已保存到 config.json"
}

# ── 6. 加 PATH（setx，幂等）───────────────────────────────────────────────────
# 把 bin 目录加到用户级 PATH（setx 永久写入，新开终端生效）。
# 幂等：先 [Environment]::GetEnvironmentVariable('PATH','User') 查是否已含，已含则跳过。
function Set-Path {
  $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
  $binDirWin = $script:BIN_DIR

  # 当前会话 PATH 已含？
  if ($env:PATH -split ';' -contains $binDirWin) {
    Write-Ok "PATH 已包含 $binDirWin"
  } else {
    # 先加到当前会话（本次安装后续步骤可用）
    $env:PATH = "$binDirWin;$env:PATH"
  }

  # 用户级注册表 PATH 是否已含？（幂等）
  if ($userPath -and (($userPath -split ';') -contains $binDirWin)) {
    Write-Ok "Windows 用户 PATH 已含 $binDirWin（跳过 setx）"
  } else {
    Write-Info "将 $binDirWin 加入 Windows 用户 PATH"
    $newPath = if ($userPath) { "$userPath;$binDirWin" } else { $binDirWin }
    try {
      setx PATH $newPath | Out-Null
      Write-Ok "Windows 用户 PATH 已更新（新开终端生效）"
    } catch {
      Write-Warn "setx PATH 失败（可能权限不足），请手动添加 $binDirWin 到用户 PATH"
    }
  }
}

# ── 7. 验证 --version ─────────────────────────────────────────────────────────
function Invoke-Verify {
  Write-Info "验证 sillyhub-daemon --version"
  $bundlePath = Join-Path $script:BIN_DIR $script:BUNDLE_NAME
  try {
    $verOut = & $script:NODE_BIN $bundlePath --version 2>$null
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "sillyhub-daemon $($verOut.ToString().Trim()) 运行正常"
    } else {
      Write-Warn "验证失败，bundle 可能需要 PATH 配置后才能运行。"
      Write-Warn "请手动执行: `"$($script:NODE_BIN)`" `"$bundlePath`" --version"
    }
  } catch {
    Write-Warn "验证失败，bundle 可能需要 PATH 配置后才能运行。"
    Write-Warn "请手动执行: `"$($script:NODE_BIN)`" `"$bundlePath`" --version"
  }
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
function Main {
  Write-Info "SillyHub daemon 安装脚本"
  Write-Info "使用服务端地址: $($script:SERVER_URL)"
  Test-NodeVersion
  Get-LatestManifest
  Download-Bundle
  Write-CmdWrapper
  Save-Config
  Set-Path
  Invoke-Verify

  Write-Host ""
  Write-Ok "安装完成！"
  Write-Host "  服务器地址已保存: $($script:SERVER_URL)"
  Write-Host "  下一步: sillyhub-daemon start --api-key <你的 API Key>"
  Write-Host "  （server_url 已写入 config.json，无需再传 --server）"
  Write-Host "  （新开 cmd/PowerShell 终端后 PATH 生效；或当前会话已临时加入）"
  Write-Host ""

  # DG-04：不自动 start。install.sh 在未提供 --server/--api-key/--token 时也跳过 start。
  # PowerShell 版本保持一致，仅打印下一步提示，由用户手动 start。
}

Main
