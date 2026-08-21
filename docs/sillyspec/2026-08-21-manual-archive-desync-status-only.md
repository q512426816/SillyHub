# CLI 归档变更在平台显示"进度回退/丢失"— 平台侧已修，工具侧改进保留

- 日期：2026-08-21（同日修复）
- 状态：**平台侧已修**（本仓 quick：读侧终态投影 + 数据补齐推送）；工具侧改进点保留为活跃建议
- 发现来源：变更 `2026-08-21-table-column-resize` 归档后，平台变更详情页显示停在"执行"阶段、"归档 0/5 步完成"，观感为归档进度丢失

## 现象

变更已完整归档（目录移入 `changes/archive/`、ROADMAP 已更新、commit `2c318fd1` 已提交），
但平台（SillyHub）变更详情页显示：

- 顶部阶段徽标"执行"（而非"已归档"），阶段条停在执行
- "归档 0/5 步完成"（看起来归档没做完）

## 根因（两段）

1. **工具侧（数据形态）**：手动归档（搬目录 + git commit，未走 `run archive --done --confirm`）
   后，CLI 的补记路径（`archiveChangeDirectory` 自愈 / `doctor --cleanup-ghosts`）只回填
   `changes.status='archived'` 一个字段。而 `status` 恰是唯一权威的"已归档"信号。
   - **设计澄清（当日核实）**：`stages.archive` 与 5 个 archive 步骤**停在 pending 是 CLI
     正规终态**——archive 是辅助阶段（`stages/index.js:23` auxiliary），阶段完成时被
     `gates.js:865-883` 整体重置回 pending 模板；正规归档的 `session-reopen-resume`
     同为 0/5 pending。`current_stage` 也**不会**推进到 'archive'（辅助阶段不写
     currentStage，`run/stage.js:147-155`）。
2. **平台侧（展示，本次已修）**：读侧投影只消费 `latest_progress.changes[0].current_stage`，
   刻意不消费 status（D-004@v2"不投 status"）→ 已归档变更永远渲染成"停在执行 + 归档 0/5"。

## 修复（2026-08-21 quick，已完成并验证）

- **数据补齐**（用户选择：把真实做完的归档步骤补记 completed）：
  `sillyspec progress complete-stage archive --change 2026-08-21-table-column-resize`
  （官方命令，stages.archive=completed + 5 步 ISO 时间戳）+ `sillyspec platform sync --change ...`
  推送。平台收到 37/37 步全 completed + status='archived'。
- **平台读侧终态投影**（read-only，不写库）：`backend/app/modules/change/service.py`
  新增 `_extract_change_status`；enrich_with_workspace_ids / enrich_summaries 命中投影时
  若 `changes[0].status == 'archived'` → 读时覆盖 `status`/`current_stage = 'archived'`
  （与平台内 `complete_stage` 终态同形，D-007），列表 `pending_review` 归 None
  （防 verify+completed 的归档推送误报待审）。D-004@v2 收窄为"仅终态投 status"。
- **前端**：`change-step-badge.tsx` 的 STAGE_LABELS/STAGE_KIND 补 `archived: "已归档"`；
  详情页绿色"已归档"徽标（STATUS_BADGE 已有键）与轮询停止（isTerminalChange）零改动自然生效。
- **验证**：详情页显示"已归档"徽标 + 时间线 37 步（归档 5/5）；历史归档变更
  （mission-converge-patrol 等，推送 status=archived）批量同形生效。
- 测试：`test_enrich_projection.py` 新增 5 个终态投影测试（30 passed）；
  `change-step-badge.test.tsx` 新增 archived 标签断言（13 passed）；change 模块 393 passed。

## 工具侧遗留改进（活跃建议，待 sillyspec 仓处理）

- 手动归档后的补记路径（自愈 / doctor ghost 清理）只回填 `status='archived'`，不提示
  用户"步骤未收尾"；建议自愈时顺带告知可用 `progress complete-stage archive` 补记，
  或在推送前对 archived 行做终态归一提示。
- `run archive --done --confirm` 幂等自愈注释声称"让收尾流程把 archive 阶段标完成"，
  实际 auxiliary 重置总会把阶段打回 pending——注释与行为不一致，建议措辞修正。

## 驾驭经验（防再踩）

- 归档务必走标准命令 `sillyspec run archive --done --confirm`（第 4 步"确认归档"由 CLI
  搬目录），不要手动搬目录 + commit 绕过；手动绕过后补记用
  `progress complete-stage archive --change <名>` + `platform sync --change <名>`。
- 平台展示进度以 `platform_change_progress.latest_progress` 推送为准；CLI 本地库与
  平台同源于该推送，改完本地库记得 sync。
