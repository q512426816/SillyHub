# Spike 01 — Git 凭据与执行环境隔离

## 验证目标

> 在同一台机器上，两个用户 A、B 并发对各自仓库 push，**互不污染、互不可见对方凭据**，且全程不污染服务器 `~/.ssh` / `~/.gitconfig`。

这是平台 V1 多人 Git 隔离设计能否成立的根本性验证。

## 前置准备

1. 准备两个测试用 Git 仓库（建议 GitHub 私库各一个）。
2. 每个仓库各创建一个 Personal Access Token (PAT)，只授权对应仓库。
3. 设置环境变量：

   **Linux / macOS**
   ```bash
   export REPO_A_URL="https://github.com/youruser/repo-a.git"
   export REPO_B_URL="https://github.com/youruser/repo-b.git"
   export PAT_A="ghp_AAA..."
   export PAT_B="ghp_BBB..."
   ```

   **Windows PowerShell**
   ```powershell
   $env:REPO_A_URL = "https://github.com/youruser/repo-a.git"
   $env:REPO_B_URL = "https://github.com/youruser/repo-b.git"
   $env:PAT_A = "ghp_AAA..."
   $env:PAT_B = "ghp_BBB..."
   ```

## 运行

**Linux / macOS**
```bash
bash run.sh
```

**Windows**
```powershell
pwsh ./run.ps1
```

## 通过准则（4 个检查全 PASS）

1. A 的临时 HOME 中**不含** B 的 PAT
2. B 的临时 HOME 中**不含** A 的 PAT
3. A 与 B 各自的 commit 作者信息分别正确
4. 清理后 `/tmp`（或 `$env:TEMP`）**不残留**任一 PAT

## 失败时的处理

- 任一 PAT 残留：检查 askpass 是否被 shred；检查父进程 env 是否被继承
- commit 作者错乱：检查 `GIT_CONFIG_GLOBAL` 是否正确指向 lease 内的 gitconfig
- Windows 环境失败：考虑 V1 只支持 Linux 服务器部署
