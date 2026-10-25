# 弹窗补丁配对键事实：id 在 metadata.agent_event.call_id（DB 无顶层列）

- **发现**：2026-10-23（变更 2026-10-23-diff-dialog-pairing-fix；初版根因判断在独立评审中修正）
- **状态**：已修复（前端配对键改读 metadata）；**无遗留数据面缺陷**

## 事实（评审修正后，与代码一致）

1. `agent_run_logs` **没有** `tool_use_id` 列（`backend/app/modules/agent/model.py` 无该列；
   `backend/app/modules/agent/schema.py:201-205` 明注“DB 无此列”——该 DTO 字段仅在
   `/logs?slim=true` 截断时由路由从完整原文解析后**内存回填**）。
2. 新轨事件的真实配对键在 **`metadata.agent_event.call_id`**：daemon 归一化器给每条
   tool_use/tool_result 事件置 `call_id`（`sillyhub-daemon/src/interactive/claude-events.ts`），
   backend `submit_steps.py` 把整条事件落进 `metadata_['agent_event']`（每行都有）。
3. 前端旧实现 `collectTurnFilePatches` 只读顶层 `entry.tool_use_id` → 真实链路上恒 undefined
   → ①精确配对**从未生效**，全部补丁落②启发式回退 → 多文件编辑轮系统性张冠李戴。
4. 前端读取先例：`frontend/src/components/daemon/trajectory/build-trajectory.ts:259-283`
   （`metadata.agent_event.call_id`）。

## 实证

会话 49c5c3ec / run 63130ca1（2026-10-23 13:30~14:17，43 文件）：点
`tests/task-runner.test.ts` 行显示 `design.md`/`requirements.md` 的编辑内容。

## 修复

- ①配对键 `entryCallId(entry)`：`metadata.agent_event.call_id` 为主，回退顶层
  `tool_use_id`（slim）与 content JSON `tool_use_id`（旧轨）；全量预建 id 索引（乱序容忍）。
- ②回退：按 `parent_tool_use_id` 轨道隔离 + 同轨唯一悬置才配，否则诚实丢弃。

## 需要注意的上游形态

- 后台子代理并行是**受支持形态**（事件按到达序落库，主/子代理行交错）——任何配对逻辑
  必须按 `parent_tool_use_id` 分轨，不能假设全局串行。
- 同轨多个并行 tool_use（一条 assistant message 多 block）出现时，无 id 补丁无法确证归属，
  平台选择诚实丢弃（弹窗出「未捕获补丁」说明）。

## 关联

- 变更：2026-10-23-diff-dialog-pairing-fix。
- 代码：`frontend/src/components/daemon/file-changes/turn-file-diff.ts`。

## 处置记录（2026-10-24 定时收口：修复已核实在 main，关闭归档）

- 独立评审修正版结论（id 在 metadata.agent_event.call_id、DB 无顶层列、回退按
  parent_tool_use_id 轨道隔离）已随变更落地：main 提交 6e6a196b4（配对键改读
  metadata.agent_event.call_id + 回退按子代理轨道隔离）+ 06f315da8（二审 P3 清偿——
  孤儿补丁不回落回退、注释口径对齐、补乱序/重复 id 用例）。本轮 grep 复核 entryCallId
  实现在 turn-file-diff.ts（:9/:113/:152-154 注释链与坑文事实一致）。
- 「需要注意的上游形态」（子代理并行分轨、同轨多 tool_use 诚实丢弃）已随二审用例
  （乱序/重复 id）入测试面。无遗留数据面缺陷。
- 处置结论：已修复且实证在 main，本文件移入 finished/。
