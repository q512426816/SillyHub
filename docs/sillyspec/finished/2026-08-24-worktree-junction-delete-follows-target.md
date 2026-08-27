# worktree node_modules junction 清理误删主仓（活跃坑）

- 日期：2026-08-24
- 场景：SillySpec execute 的 worktree 前端依赖靠 junction 指向主仓 `frontend/node_modules`（local.yaml provisionDeps 设计）。为对照测试临时建的基线 worktree 也做了同样 junction；清理临时 worktree 时 `git worktree remove --force`（报 Directory not empty 未删净）后接着 `Remove-Item -Recurse -Force`——PowerShell 会**跟进 junction 递归删除目标内容**，把主仓 node_modules 大半删掉（.bin 全空、仅剩 50 项）。
- 症状：后续任何 `pnpm exec vitest/tsc` 报「不是内部或外部命令」；sillyspec verify 的 CLI 测试对账以 `vitest 未找到` 失败。
- 修复：`pnpm install --force`（16 秒级恢复，pnpm store 内容寻址）；修复后 33 个 bin shim、tsc 零错、测试全绿。
- 规避（后续会话铁律）：
  1. 删除含 junction 的目录前，先 `Get-Item <path> | Select LinkType` 确认；junction 本身用 `fsutil reparsepoint delete` 或先 `(Get-Item <junction>).Delete()` 摘链接再删目录，**绝不**对含 junction 的树直接 `-Recurse -Force`。
  2. `git worktree remove --force` 对含 junction 的 worktree 报 Directory not empty 时，停手排查而非换更暴力的删除命令。
  3. worktree 侧 junction 建议改用 `rmdir <junction>`（cmd）或 `[System.IO.Directory]::Delete(path)`（不跟随）只摘链接。
- 关联：本仓 local.yaml 注释「frontend/daemon node_modules 由 provisionDeps 模块 link 自动 junction 主仓」；2026-08-23-frontend-dark-theme verify 首轮曾中招。
