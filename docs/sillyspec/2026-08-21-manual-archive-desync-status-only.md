# 手动归档后 CLI 补记只改 status，不收尾 archive 阶段 steps/stages → 平台进度显示"回退/丢失"

- 日期：2026-08-21
- 状态：活跃坑（待工具修复）
- 发现来源：变更 `2026-08-21-table-column-resize` 归档后，平台变更详情页显示"归档 0/5 步完成"、当前阶段停在"执行"，观感为归档进度丢失

## 现象

变更已完整归档（目录移入 `changes/archive/`、ROADMAP 已更新、commit `2c318fd1` 已提交），
但平台（SillyHub）变更详情页显示：

- 顶部阶段徽标"执行"，阶段条停在执行，**归档段 0/5 步完成**（看起来归档没做完）
- 任务看板 0/0（次要，见"平台侧连带问题"）

## 证据（主仓 `.sillyspec/.runtime/sillyspec.db`，change `2026-08-21-table-column-resize`）

- `changes.status = 'archived'`，但 `current_stage = 'execute'`
- `stages` 表：brainstorm/plan/execute/verify 均 completed，**`archive` 仍 `pending`**
- `steps` 表：archive 阶段 5 步（任务完成度检查/extract-module-impact/sync-module-docs/确认归档/更新路线图和提交）**全部 `pending`、completed_at 全空**
- 03:37:51Z 推送到平台的 JSON 原样携带了这套自相矛盾的终态（status=archived + current_stage=execute + 归档 0/5）

## 根因

时间线（UTC）：03:32:47 归档 commit（**AI 手动搬目录 + git commit**，未走 CLI 步骤流程）→
03:37:51 某个 sillyspec 命令写库并推送。写库走的是"补记"路径之一：

1. `archiveChangeDirectory` 幂等自愈（issue `archive-stage-physical-tracking-desync`，
   `src/run/complete-handlers.js`）：源目录不存在 → `findAlreadyArchivedDir` →
   **仅 `unregisterChange`（UPDATE changes SET status='archived'）** 后返回；
2. 或 `sillyspec doctor --cleanup-ghosts --confirm`（目录不在 active 下被判幽灵行，
   同样仅把 status 改 archived，见 docs/sillyspec/finished/2026-08-20-doctor-sqlite3-dep-and-ghost-cleanup.md）。

两条路径共同缺陷：**只回填 status，不把 archive 阶段 steps 标 completed、不推进
stages.archive、不推进 current_stage**。而平台进度展示（`platform_change_progress.latest_progress`）
完全以这份数据为准，于是已完成的归档在平台上呈现为"没归档完"。

`handleArchiveConfirmStep` 自愈注释声称"让收尾流程把 archive 阶段标完成"，但实测库内
5 步全 pending，收尾未兑现（自愈 return 后 completeStep 是否继续写库待工具仓核实）。

## 平台侧连带问题（SillyHub，独立于本坑但加重观感）

- `change/service.py` 投影明确"不投 status"（D-004@v2）：`_extract_current_stage` 只取
  `current_stage`，不消费 `changes[0].status`，已归档变更详情页不切终态渲染；
- 平台 `changes.status` 自身从不更新（全表 draft）、`archived_at` 空，归档语义只有
  `location=archive`；
- 任务看板依赖平台 `tasks` 表 reparse 入库，CLI 本地开发的变更从未入库（8 月变更仅
  08-10 一例有任务行），看板恒 0/0；
- `changes.title` 被 reparse 覆盖为 proposal.md 的 H1（"提案书（Proposal）— …"），
  覆盖了正确的变更标题；
- 容器镜像 `C:\data\spec-workspaces\<ws>\changes\` 下残留已归档变更的空目录
  （如 `2026-08-21-table-column-resize/tasks/`），repo→镜像同步删除逻辑不清理空目录。

## 建议修复

- **工具仓（sillyspec）**：自愈 / doctor-ghost 两条补记路径在改 `status='archived'` 的同一事务里，
  把该 change 的 archive 阶段 steps 全部标 completed（completed_at=now）、`stages.archive`
  置 completed、`current_stage` 推进到 archive；或推送前对 archived 行做终态归一。
- **平台（multi-agent-platform）**：读侧投影消费 `latest_progress.changes[0].status`，
  archived 时详情页按"已归档"终态渲染（徽标/阶段条全绿），不依赖 current_stage=execute。
