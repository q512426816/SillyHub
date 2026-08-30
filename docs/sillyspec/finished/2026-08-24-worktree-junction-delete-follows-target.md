# worktree node_modules junction 清理误删主仓（已确认规避方案）

- 日期：2026-08-24（2026-08-30 补充 git worktree remove 同样穿透的证据）
- 场景：SillySpec execute 的 worktree 前端依赖靠 junction 指向主仓 `frontend/node_modules`（local.yaml provisionDeps 设计）。为对照测试临时建的基线 worktree 也做了同样 junction；清理临时 worktree 时 `git worktree remove --force`（报 Directory not empty 未删净）后接着 `Remove-Item -Recurse -Force`——PowerShell 会**跟进 junction 递归删除目标内容**，把主仓 node_modules 大半删掉（.bin 全空、仅剩 50 项）。
- 症状：后续任何 `pnpm exec vitest/tsc` 报「不是内部或外部命令」；sillyspec verify 的 CLI 测试对账以 `vitest 未找到` 失败。
- 修复：`pnpm install --force`（16 秒级恢复，pnpm store 内容寻址）；修复后 33 个 bin shim、tsc 零错、测试全绿。
- **2026-08-30 新证据：`git worktree remove`（不带 --force）同样会穿透 junction 删目标内容**。
  清理 `.sillyspec/.runtime/worktrees/2026-08-29-batch-session-inherit`（内含
  `sillyhub-daemon/node_modules` junction → 主仓）时：先做全树扫描（`dir /AL /S`
  报 0 个 reparse point，**该扫描本身漏报**——junction 实际存在，事后单目录
  `dir /AL` 才现形）；直接 `git worktree remove` 报 `Directory not empty` 退出 255，
  但它递归删除已**先穿透 junction 掏空主仓 `@modelcontextprotocol/sdk`**（目录在、
  package.json/dist 全没了），随后 `pnpm bundle` 报 4 处 TS7006 隐式 any（SDK 类型
  加载失败→工具注册回调推断塌缩）才暴露。修复同下：`pnpm install --force`。
  教训：**报错 ≠ 没删成**——git 报 Directory not empty 中止时，穿透删除已经发生；
  且单一扫描手段（dir /AL /S）不可尽信，删除前用 `find <dir> -type l`（Git Bash
  对 junction 识别为 symlink）+ 单目录 `dir /AL` 双重确认。
- 规避（后续会话铁律，**顺序是关键——必须在 git worktree remove 之前摘链接**）：
  0. **先摘链接再 remove**：`find <worktree> -type l` 枚举全部链接 → 逐个
     `cmd //c rmdir <junction>`（只摘链接不跟随）→ 再 `git worktree remove`
     （此时已无 junction，安全）→ `git worktree prune`。绝不能先 remove 等
     "Directory not empty" 再补救——损坏在报错前已发生。
  1. 删除含 junction 的目录前，先 `Get-Item <path> | Select LinkType` 确认；junction 本身用 `fsutil reparsepoint delete` 或先 `(Get-Item <junction>).Delete()` 摘链接再删目录，**绝不**对含 junction 的树直接 `-Recurse -Force`。
  2. ~~`git worktree remove --force` 对含 junction 的 worktree 报 Directory not empty 时，停手排查而非换更暴力的删除命令。~~（2026-08-30 修订：停手正确但太晚，见新证据；正确做法是第 0 条的事前摘链接。）
  3. worktree 侧 junction 建议改用 `rmdir <junction>`（cmd）或 `[System.IO.Directory]::Delete(path)`（不跟随）只摘链接。
- 中招后的恢复信号：`pnpm <cmd>` 报一堆与本次改动无关的 TS7006/模块缺失类错误时，
  先怀疑 node_modules 被穿透删除，`ls node_modules/<报错包>` 看目录是否空壳，
  然后 `pnpm install --force`（普通 install 因包目录"存在"不会重装，必须 --force）。
- 关联：本仓 local.yaml 注释「frontend/daemon node_modules 由 provisionDeps 模块 link 自动 junction 主仓」；2026-08-23-frontend-dark-theme verify 首轮曾中招。
