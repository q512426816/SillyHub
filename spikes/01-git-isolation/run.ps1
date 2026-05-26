# Spike 01 — Git 凭据隔离 (Windows PowerShell 版本)
$ErrorActionPreference = "Stop"

if (-not $env:REPO_A_URL) { throw "REPO_A_URL not set" }
if (-not $env:REPO_B_URL) { throw "REPO_B_URL not set" }
if (-not $env:PAT_A) { throw "PAT_A not set" }
if (-not $env:PAT_B) { throw "PAT_B not set" }

$root = Join-Path $env:TEMP ("sillyspec-spike-01-" + [Guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Path $root | Out-Null
Write-Host "[spike01] root=$root"

function Run-AsUser($userId, $repoUrl, $pat) {
  $home = Join-Path $root "$userId/home"
  $worktree = Join-Path $root "$userId/repo"
  New-Item -ItemType Directory -Path $home -Force | Out-Null

  # Windows 上 git 调用 GIT_ASKPASS 的程序，写成 .cmd
  $askpass = Join-Path $home "askpass.cmd"
  Set-Content -Path $askpass -Value "@echo $pat" -Encoding ASCII

  $gitconfig = Join-Path $home "gitconfig"
  @"
[user]
  name = $userId-bot
  email = $userId@spike.local
[credential]
  helper =
"@ | Set-Content -Path $gitconfig -Encoding UTF8

  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

  $env:GIT_CONFIG_GLOBAL = $gitconfig
  $env:GIT_CONFIG_SYSTEM = "NUL"
  $env:GIT_TERMINAL_PROMPT = "0"
  $env:GIT_ASKPASS = $askpass
  $env:HOME = $home

  git clone --depth 1 $repoUrl $worktree
  Push-Location $worktree
  try {
    git checkout -b "spike-$userId-$ts"
    "spike marker for $userId at $ts" | Set-Content -Path "spike-marker-$userId.txt" -Encoding UTF8
    git add "spike-marker-$userId.txt"
    git commit -m "spike: $userId isolation test"
    git push origin "HEAD:spike-$userId-$ts"
  } finally {
    Pop-Location
  }

  Remove-Item -Force $askpass
}

# Windows 上没办法严格 env -i，做最大努力隔离
Write-Host "[spike01] running A and B sequentially (Windows can't fully isolate env)..."
Run-AsUser "user-a" $env:REPO_A_URL $env:PAT_A
Run-AsUser "user-b" $env:REPO_B_URL $env:PAT_B

$pass = 0; $fail = 0
function Check($name, $ok) {
  if ($ok) { Write-Host "  [PASS] $name"; $script:pass++ }
  else     { Write-Host "  [FAIL] $name"; $script:fail++ }
}

Write-Host "`n=== 验证 ==="

$aDir = Join-Path $root "user-a"
$bDir = Join-Path $root "user-b"

$aHasB = (Select-String -Path "$aDir\*" -Pattern $env:PAT_B -Recurse -ErrorAction SilentlyContinue)
Check "A home 不含 B 的 PAT" (-not $aHasB)

$bHasA = (Select-String -Path "$bDir\*" -Pattern $env:PAT_A -Recurse -ErrorAction SilentlyContinue)
Check "B home 不含 A 的 PAT" (-not $bHasA)

Push-Location (Join-Path $aDir "repo")
$aAuthor = (git log -1 --format='%ae')
Pop-Location
Check "A author=user-a@spike.local (实际=$aAuthor)" ($aAuthor -eq "user-a@spike.local")

Push-Location (Join-Path $bDir "repo")
$bAuthor = (git log -1 --format='%ae')
Pop-Location
Check "B author=user-b@spike.local (实际=$bAuthor)" ($bAuthor -eq "user-b@spike.local")

# 清理
Remove-Item -Recurse -Force $root

$leakA = (Select-String -Path "$env:TEMP\*" -Pattern $env:PAT_A -Recurse -ErrorAction SilentlyContinue)
Check "TEMP 不残留 PAT_A" (-not $leakA)

$leakB = (Select-String -Path "$env:TEMP\*" -Pattern $env:PAT_B -Recurse -ErrorAction SilentlyContinue)
Check "TEMP 不残留 PAT_B" (-not $leakB)

Write-Host "`n=== 结果：PASS=$pass FAIL=$fail ==="
if ($fail -eq 0) { Write-Host "[spike01] SPIKE PASSED" }
else { Write-Host "[spike01] SPIKE FAILED"; exit 1 }
