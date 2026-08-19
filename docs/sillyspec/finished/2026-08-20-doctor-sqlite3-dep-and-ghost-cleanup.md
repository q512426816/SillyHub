# doctor 依赖外部 sqlite3 CLI + 幽灵行无清理动作（SS-1/SS-2）— 已修复

- 日期：2026-08-20
- 状态：已修复（工具仓 commit `12515f8`，随 3.26.13+ 发布；本机全局 symlink 即时生效）
- 发现来源：平台全量审计 docs/platform-audit-2026-08-20.md

## 问题

1. **SS-1**：`sillyspec doctor` 的僵尸/孤儿对账 bash 模板依赖外部 sqlite3 CLI（Windows 默认没有），
   `execSync('sqlite3 ...')` 失败后静默回退 `known=∅` → 必然把全部活跃目录误报「孤儿目录（可清理）」，
   且报告指引 `rm -rf`——清理建议建立在空集合上，属危险误导。
2. **SS-2**：`progress show` 对目录缺失的残留记录提示「可用 doctor 清理」，但 doctor 对幽灵行
   （db active 无目录）只 WARNING 不给动作（cleanupRemnantDbs 仅删 0 字节 db）——提示与能力不符，
   主仓累积 53 条残留记录永远清不掉。

## 修复（工具仓 C:\Users\qinyi\IdeaProjects\sillyspec）

- `src/stages/doctor.js`：sqlite3 查询全部改 `node:sqlite`（node≥22.13 内置，sillyspec 引擎硬要求，
  必然可用）；db 读取失败时明确提示「跳过孤儿判定，不做清理建议」，不再静默降级。
- `src/doctor-diagnostics.js`：D4 一致性检查从 count 粗对齐升级为精确集合对账，逐名列出
  `ghost_rows` / `orphan_dirs`；新增 `cleanupGhostChanges`（默认 dry-run；`--confirm` 仅把
  changes.status 改 archived，可逆，不删任何行/目录；孤儿目录不自动删，留给人工归位）。
- `src/index.js`：接线 `sillyspec doctor --cleanup-ghosts [--confirm]`。
- `src/progress/stage-machine.js`：残留记录提示改为具体命令。
- 回归：工具仓全量测试通过（doc-ref-check 5 处行号漂移随提交同步修正）。

## 主仓善后（同日完成）

- `sillyspec doctor --cleanup-ghosts --confirm` 归档 53 条幽灵行（活跃 64→12；
  含 46 个 quick-\<hex\> 与 default/llm-provider-management/auth-refresh-token-index 等具名残留）。
- 清理 .runtime 下 5 份旧 .bak（约 4MB）、88 个 current-*-run-id-* 残留、空嵌套 .sillyspec 目录、
  ghost_changes_backup_20260819.json；保留清理后快照 db-backup-after-ghost-cleanup-20260820。
- 遗留：`.sillyspec/changes/2026-08-19-sessions-workspace-selector` 有目录无主库 active 行，
  但 meta.json 指向它（worktree 模式，记录可能在 worktree 隔离库）——保留目录待确认，勿删。
