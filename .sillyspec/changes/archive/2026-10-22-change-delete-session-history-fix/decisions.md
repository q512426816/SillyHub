---
author: flow-machine-draft
created_at: 2026-10-22T10:23:00.034Z
---
# 决策记录（Decisions）— 2026-10-22-change-delete-session-history-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：改为 SET NULL 后，被删 change 的执行 run 会保留但失去 change 归属；`_change_run_ids` 的无锚分支可能把这些 run 归到同会话其它 change，导致用量报表轻微漂移。缓解：仅在 change 物理删除（低概率）时发生，用量按 run 去重不重复计数；在 `agent.md`/`change.md` 文档登记该语义。 回灌格式风险：引擎 JSONL 与 daemon 线上上报格式存在细微差异，渲染可能不完全一致。缓解：严格对齐 `_persist_agent_event` 的 `[ASSISTANT]/[THINKING]/[TOOL_USE]/[TOOL_RESULT]` 前缀与 `metadata.agent_event` 形状；回灌行带 `restored_from` 标记，便于按 run id 回收；生产先 dry-run 再 apply。 迁移对账误伤：全局 `turn_count` 下调可能影响未知会话。缓解：只下调（`turn_count > expected`），expected 只统计有 user_input 日志的 run，`tool_report` 的 0 语义天然保留；迁移前备份 `agent_sessions`。 放弃方案 A：只把 reparse 里的 `session.delete` 改成逐条搬 run——路径多（reparse、占坑回滚、未来新增删除入口），漏一处就复发，不是根治。 放弃方案 B：把左栏轮数改为列表接口实时聚合 `count(runs)`——改动面大、每会话子查询性能风险，且会改变 `tool_report` 的 `turn_count=0` replay 语义；保留存储列 + 对账路径更稳。
