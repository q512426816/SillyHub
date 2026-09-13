# agent 日志 hub 归属跨会话污染：本地 IDE 的 zcode 日志挂到无关平台 pi 会话（2026-09-11）

## 现象

阿里云平台会话 `e3d7ddfa-666e-4c2d-9d52-eb0ccb16079d`（provider=**pi**，daemon 派发，
cwd=本仓库）的「本地 agent 目录」卡片里，出现一条与它毫无关系的 **zcode** 日志：

- `model-io-sess_subagent_agent_bb7d897d-540f-4318-a53c-39574c439743.jsonl`（16.4 MB）
- 平台行：`last_seen=2026-09-09T16:35:57Z`（北京 09-10 00:35:57）/ invocations=11 /
  last_command=`execute --change` / harness=zcode。

本机 zcode 库（`~/.zcode/cli/db/db.sqlite`）实证：该 subagent 的父会话是**本地 IDE 的
zcode 会话** `sess_2785c997`（标题「会话页面中 PI 和 cursor 顶部的【99.4K…】token…」，
09-09 16:32 ~ 09-10 09:06 活跃），subagent 本身 09-10 00:03~00:23 活跃（worktree TaskCard
执行者）。与平台 pi 会话无任何进程/血缘关系。

## 根因链（全部实证）

1. **junction 共享留底**：daemon workspace 的规范目录
   `~/.sillyhub/daemon/specs/b97f8231-…` 是 junction → 本仓库 `.sillyspec/`（2026-09-09
   13:20 迁移，见 `platform-spec-junction-migration-split.md`）。于是本地 IDE 会话与
   daemon 平台会话的 sillyspec CLI **读写同一份**
   `.sillyspec/.runtime/agent-session-log.json`（留底 top-10 entries 混存两边的检出）。
   迁移前（拷贝布局）两侧 cwd 不同、留底分离，不会互相污染——本坑是 junction 布局引入的。
2. **全量重推**：`sillyspec run` 每次把合并后的 ledger top-10 **整批** POST
   `/api/agent-logs`（`agent-session-log.js` recordAgentLogInvocation：push payload =
   `entries: merged.entries`），body 级 `hub_session_id` 来自 env `SILLYHUB_SESSION_ID`
   ——即「这台机器这个 cwd 最近活跃的 agent 日志快照」被当作「本平台会话的产物」上报。
3. **平台 hub 归属无一致性防线**：`platform_sync/service.py` hub 分支只做
   `last_seen_at ≥ 会话 created_at` 的时间重叠过滤（ql-20260827-016-2b4c，防的是早于会话
   创建的旧账），不校验 harness 与会话 provider 一致（zcode 条目挂进 pi 会话），也不校验
   条目是否真由本会话进程检出。bb7d897d 的 last_seen 晚于 e3d7ddfa 创建时间 → 通过过滤
   → `agent_session_id=e3d7ddfa` 落库，还会**覆盖原归属**（原本 ctx 分支挂 tool_report 会话）。

## 影响

- 平台会话的「本地 agent 目录」出现无关（甚至 harness 都对不上）的本机日志卡片，误导排查；
- 同机制会把条目从原 tool_report 会话「抢走」改挂 hub 会话（时间窗重叠时）；
- 只要用户本地在同一仓库开着 ZCode/IDE 会话、同时 daemon 在该仓库跑平台会话，就会复现。

## 对工具/平台的改进建议

- **CLI 侧（根治）**：带 `hub_session_id` 的推送只上报**本会话进程自己检出/更新**的条目
  （本次 `detected` 集合），不再重推共享 ledger 的存量条目；或 entry 记录检出者会话标识，
  平台只挂匹配者。
- **平台侧（防线）**：hub 归属加 harness ↔ 会话 provider 一致性校验（映射参照
  `_tool_report_provider`），不一致仅入库不改挂。
- **布局侧（缓解）**：junction 共享 `.sillyspec` 时，`.runtime/agent-session-log.json`
  按会话分文件或加会话维度键，避免跨会话混写。

状态：活跃坑（待修复；平台侧防线 + CLI 侧 push 收敛二选一或都做）。

## 处置记录（2026-09-12 定时收口，根治落地，归档）

- **根治已随 sillyspec f252557 落地（变更 2026-09-11-agent-log-attribution-refactor task-01/02）**：会话身份锚定 + 推送收敛——带 hub_session_id 的推送只上报**本次 run 自己检出/更新的 own 条目**（`payloadEntries = merged.entries.filter(ownPaths)`），「共享 ledger 存量全量重推被当本会话产物」的根因消除；agent-session-log / quicklog-soft-attribution 测试复跑绿。
- **平台侧防线（harness↔provider 校验）经核对为用户否决项**：refactor design 非目标 D-009 明示「不做 harness↔provider 一致性拦截——跨 harness 同变更挂接是需求」。巡检一度按本文件建议实现该防线，核对设计后即刻回退（本条留痕防再犯）。
- **布局侧（junction 留底分文件）同为非目标**：design「daemon 不改——own-anchoring 下各会话只更新 own 条目，共享留底退化为本地调试产物，无害化」。
- 事故场景回归口径：本地 IDE 与 daemon 平台会话并存时，pi 会话不再吸入 zcode 存量日志（own-only 收敛后 hub 推送里根本没有他者条目）。归档。
