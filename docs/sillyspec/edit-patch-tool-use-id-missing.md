# edit_patch 日志行 tool_use_id 缺失——弹窗补丁配对被迫走回退

- **发现**：2026-10-23（变更 2026-10-23-diff-dialog-pairing-fix 排查期）
- **状态**：活跃（前端兜底已修：就近悬置配对；数据面丢 id 环节未定）

## 现象

轮文件变更弹窗（turn-file-diff-dialog）的补丁按 tool_use_id 与 tool_call 行配对；
补丁行（`agent_run_logs.edit_patch` 所在行）的 `tool_use_id` 缺失时配对退化为启发式
回退。实证会话：49c5c3ec / run 63130ca1（2026-10-23 13:30~14:17 轮，43 文件）——
点 `tests/task-runner.test.ts` 行显示 `design.md`/`requirements.md` 的编辑内容
（旧回退「按序塞给路径命中的第一个未用调用」张冠李戴，真补丁被挤掉丢弃）。

## 已定位事实

- backend sdk_pipeline 双侧写 id 的前提是事件 `call_id` 在：
  `sillyhub-daemon/src/interactive/claude-events.ts:529-531`（tool_result 从 block
  `tool_use_id` 提取 call_id）与 `backend .../run_sync/service/sdk_pipeline.py:560-572`
  （call/result 双侧 `tool_use_id` 列）。
- claude 本地 transcript（~/.claude/projects）与 zcode rollout（~/.zcode/cli/rollout）
  均无 structuredPatch（0 命中）——edit_patch 只存在于 daemon 事件流→上报→落库链，
  本地无取证面。
- 现象反证：实证轮弹窗错配 ⇒ 该轮补丁行 id 缺失（id 齐全则①精确配对不会错）。

## 待查（后续变更根治）

1. 平台侧取证：`GET /api/daemon/sessions/49c5c3ec-.../logs?run_id=63130ca1-...`
   抽查补丁行顶层 `tool_use_id` 与 tool_call 行 content JSON 内 `tool_use_id`
   （2026-10-23 当日该端点对长会话持续超时未取到；可从生产库直查
   `agent_run_logs`）。
2. 嫌疑环节：claude-events 归一化器对「Edit 结构化结果消息」的 record 形态解析
   （edit_patch 取自 `record.tool_use_result` 顶层，而 call_id 取自 content block
   `tool_use_id`——两种形态若不同源同条，可能出现 edit_patch 附着但 call_id 缺）。
3. 修复后撤前端兜底或降级为纯观测（id 齐全时①已覆盖）。

## 关联

- 前端止血：2026-10-23-diff-dialog-pairing-fix（就近悬置配对；串行协议推理）。
- 链路文档：turn-file-diff.ts 头注、sdk_pipeline.py 注释（ql-20260706-002）。
