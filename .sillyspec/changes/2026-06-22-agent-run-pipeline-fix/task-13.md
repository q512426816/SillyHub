---
id: task-13
title: "[D3][daemon+backend] tool_call JSON 与 stdout [TOOL_USE] 补 tool_use_id 字段"
priority: P1
depends_on: []
blocks: [task-14]
requirement_ids: [FR-09]
decision_ids: [D-002@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\sillyhub-daemon\src\task-runner.ts
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\run_sync\service.py
author: qinyi
created_at: 2026-06-22T21:19:09
---
# task-13: [D3][daemon+backend] tool_call JSON 与 stdout [TOOL_USE] 补 tool_use_id 字段

## 修改文件
- `C:\Users\qinyi\IdeaProjects\multi-agent-platform\sillyhub-daemon\src\task-runner.ts`
  - 第 1249-1305 行：`_eventToMessages` 的 `case 'tool_use':` 分支
  - 第 1250-1253 行：`name` 提取（`md.tool_name`）
  - 第 1254-1259 行：`inputObj` 提取（`md.tool_input`）
  - 第 1260-1278 行：stdout `[TOOL_USE] Name: <command/json>` emit
  - 第 1281-1304 行：tool_call channel JSON emit（`tcContent = JSON.stringify({...})` 在 :1284-1290，字段 `tool/args/timestamp/status/success`，**无 id**）
  - 第 1300-1304 行：push `{event_type, content: tcContent, channel: 'tool_call'}`
- `C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\run_sync\service.py`
  - 第 691-850 行：`_extract_sdk_messages(msg)` —— interactive 模式完整 SDK message 展开
  - 第 780-824 行：`btype === 'tool_use'` 分支 —— stdout `[TOOL_USE]` (:793-802) + tool_call JSON (:805-824）
  - 第 805-812 行：`tc_payload = {"tool","args","timestamp","status","success"}`，**无 id**
  - 第 818-824 行：push `{event_type:'tool_use', content: tc_json, channel:'tool_call'}`

**注意（daemon-service-split 真实路径）**：design.md §5.3 引用的 `service.py:3418-3462` 是拆分前旧路径。`_extract_sdk_messages` 现位于 `backend/app/modules/daemon/run_sync/service.py:691-850`，tool_use 分支在 :780-824。本任务改 `run_sync/service.py`，**不改 facade `service.py`**。

## 覆盖来源 (design.md §5.3.3 / requirements.md FR-09)
- design.md §5.3 根因：tool_call 双写是故意的（stdout 人读 + JSON 给前端），但前端 ±3 窗口（`normalize.ts:359-386`）漏合并。
- design.md §5.3.3 修复（源头补字段）：`task-runner.ts:1284-1304`（本任务实际 1281-1304）/ `service.py:3443-3462`（本任务实际 run_sync/service.py:805-824）emit tool_call JSON 时加入 `tool_use_id`。当前日志样例 `{"tool","args","timestamp","status","success"}` 不含 id。id 取自 SDK `content_block_start` 事件的 tool_use block 的 id 字段（delta 流和完整 message 共享同一 block id）。
- design.md §5.3.3 退化方案：若 SDK 不提供稳定 block id，退化为"时间戳邻近 + tool 名匹配"启发式配对（扩大窗口上限并去重），并接受偶发漏配对。
- design.md §13 自审存疑 2（Grill X-001）：§5.3.3 依赖 `tool_use_id`，但当前 tool_call JSON 不含该字段。execute 验证 SDK 是否提供稳定 block id。
- requirements.md FR-09：同一 tool 调用只展示一张卡片（含 stdout [TOOL_USE] 与 tool_call JSON 距离超出旧 ±3 窗口的场景）。

## 实现要求 (编号步骤)
1. **验证 SDK tool_use block id 来源（execute 第一步）**：读 Claude Code SDK（或 daemon 用的 driver）的 `content_block_start` 事件，确认 tool_use block 带 `id` 字段（如 `toolu_01abc...`）。同时确认 `content_block_delta`（input_json_delta）和完整 assistant message 的 `content[i]`（type=tool_use）都携带同一 `id`。抓真实 agent-run 日志（`agent-run-7142b6cb.log`）grep `tool_use` 确认 id 字段存在。
2. **task-runner.ts `case 'tool_use'` 提取 id**：在 :1250-1259 附近，从 `md` 提取 tool_use id：
   ```typescript
   const toolUseId =
     typeof md.tool_use_id === 'string' && md.tool_use_id
       ? md.tool_use_id
       : (typeof md.id === 'string' && md.id ? md.id : '');
   ```
   字段名需 execute 确认（SDK 事件 metadata 里是 `tool_use_id` 还是 `id`；若是 `content_block_start` 的 `content_block.id`，daemon 的 StreamJsonAdapter 解析时可能存到不同字段）。抓日志确认。
3. **stdout [TOOL_USE] 行携带 id**：:1273 `stdoutContent` 当前是 `[TOOL_USE] ${name}: ${argsLine}`。改为带 id（可读 + 可解析）：
   ```typescript
   const stdoutContent = toolUseId
     ? `[TOOL_USE] ${name} (${toolUseId}): ${argsLine}`.slice(0, 2000)
     : `[TOOL_USE] ${name}: ${argsLine}`.slice(0, 2000);
   ```
   或用 metadata 透传（不污染文本）：`messages.push({ event_type, content: stdoutContent, channel: 'stdout', metadata: { toolUseId } })`。**推荐 metadata 方案**（前端 normalize 解析 metadata，不依赖文本正则）。需确认 daemon message 协议是否支持 metadata 字段透传到 backend（task-11 已为 thinking 做了类似扩展，参照）。
4. **tool_call JSON 加 tool_use_id**：:1284-1290 `tcContent = JSON.stringify({...})` 加字段：
   ```typescript
   tcContent = JSON.stringify({
     tool: name,
     tool_use_id: toolUseId || undefined,  // 新增
     args: inputObj,
     timestamp: ts,
     status: 'allowed',
     success: true,
   });
   ```
   `toolUseId` 为空时（SDK 没给）省略字段（或设为 null），前端 normalize 退化到 ±3 窗口。
5. **run_sync/service.py `_extract_sdk_messages` 对齐**：:780-824 `btype === 'tool_use'` 分支，从 block 提取 id：
   ```python
   tool_use_id = b.get("id") or ""  # SDK tool_use block 的 id 字段
   ```
   完整 SDK message 的 `content[i]` (type=tool_use) 标准 Anthropic API 形状带 `id` 字段（如 `toolu_xxx`），execute 确认。
6. **backend stdout [TOOL_USE] 行携带 id**：:793 `stdout_content` 同 task-runner 改法（文本带 id 或 metadata 透传）：
   ```python
   stdout_content = (
       f"[TOOL_USE] {name} ({tool_use_id}): {args_line}"[:2000]
       if tool_use_id else
       f"[TOOL_USE] {name}: {args_line}"[:2000]
   )
   ```
   或用 metadata（与 task-runner 一致）。
7. **backend tool_call JSON 加 tool_use_id**：:806-812 `tc_payload` 加字段：
   ```python
   tc_payload = {
       "tool": name,
       "tool_use_id": tool_use_id or None,  # 新增
       "args": input_obj,
       "timestamp": ts,
       "status": "allowed",
       "success": True,
   }
   ```
8. **退化方案**：若 execute 验证 SDK 完全不给 stable id（罕见，Anthropic API 标准 tool_use block 必有 id），task-runner / service 都把 `toolUseId` 设为空字符串，tool_call JSON 省略 `tool_use_id` 字段，前端 normalize 保留现有 ±3 窗口（:359-386）兜底。本任务仍需完成 id 提取代码（即使为空），让 task-14（前端）能据有无 id 切换配对策略。

## 接口定义 (函数签名/DTO)
- task-runner `_eventToMessages` 产出（batch mode）：
  ```typescript
  type ToolUseStdoutMessage = {
    event_type: 'tool_use';
    content: string;  // [TOOL_USE] Name (toolu_xxx): <args> 或 metadata 携带
    channel: 'stdout';
    metadata?: { toolUseId: string };
  };
  type ToolCallJsonMessage = {
    event_type: 'tool_use';
    content: string;  // JSON
    channel: 'tool_call';
    metadata?: { toolUseId: string };
  };
  type ToolCallPayload = {
    tool: string;
    tool_use_id?: string;  // 新增
    args: Record<string, unknown>;
    timestamp: string;
    status: string;
    success: boolean;
  };
  ```
- backend `_extract_sdk_messages` 产出（interactive mode，对齐 task-runner）：同上形状。
- 前端 `parseToolCallContent`（normalize.ts，task-14 范围）从 `content` JSON 解析 `tool_use_id`，与 stdout `[TOOL_USE]` 行的 metadata.toolUseId 或文本里的 `(toolu_xxx)` 关联。

## 边界处理 (≥5条)
1. **SDK 不提供 stable id（退化）**：task-runner `md.tool_use_id` / `md.id` 都为空 → `toolUseId=''` → tool_call JSON 省略 `tool_use_id` 字段 → 前端 normalize 退回 ±3 窗口（:359-386）。本任务不阻塞退化路径。
2. **id 唯一性**：SDK tool_use block 的 `id`（`toolu_xxx`）由 Anthropic API 保证全局唯一（同 message 内 + 跨 message）。无需额外去重。但若 daemon 重试/重放导致同一 id 出现多次，前端 normalize 需按 id 去重（task-14 范围）。
3. **tool 无 result（进行中）**：tool_use emit 后，tool_result 可能在后续 turn 才到（或永远不到，agent 中断）。tool_call JSON 的 `status`/`success` 字段当前写死 `'allowed'/true`（task-runner :1288-1289 / service :810-811），与 result 无关。`tool_use_id` 让前端能在后续 [TOOL_RESULT] 到达时按 id 关联（result 也需带 tool_use_id，但当前 result emit 不带 —— 本任务只补 tool_use 侧，result 侧属 task-14 前端启发式或后续 task）。
4. **result 无 tool_use_id（孤儿）**：[TOOL_RESULT] 行当前不带 tool_use_id（task-runner :1307-1316 `case 'tool_result'` 只 emit `[TOOL_RESULT] <content>`）。前端 normalize 若拿不到 result 的 id，退化为时间戳邻近关联。本任务不改 result emit（超范围），但 design §5.3.3 提到"result 也应带 id"，可作为后续优化（本任务非目标）。
5. **batch mode 与 interactive mode 一致**：task-runner.ts（batch mode，daemon 调 CLI 子进程解析 stdout）和 run_sync/service.py（interactive mode，daemon 直传 SDK message）两路径都必须补 `tool_use_id`，前端才能统一关联。只改一边会导致 batch / interactive 日志形状不一致，前端 normalize 需分叉处理（违反统一性）。
6. **字段命名一致**：task-runner（TS）用 `tool_use_id`（snake_case，与 Anthropic API 一致），service.py（Python）也用 `tool_use_id`，前端 normalize 解析时统一 key。禁止一边 `toolUseId`（camelCase）一边 `tool_use_id`。
7. **metadata 字段透传**：若用 metadata 携带 toolUseId（推荐，不污染文本），需确认 daemon → backend HTTP JSON 序列化保留 metadata（task-11 已为 thinking 验证过路径），且 backend `submit_messages`（run_sync/service.py:83-91）的 `flat_messages` 构造保留 metadata 字段（当前只看 event_type/content，需扩展）。
8. **stdout 文本长度**：`[TOOL_USE] Name (toolu_xxx): <args>` 比 原 `[TOOL_USE] Name: <args>` 多 ~15 字符（id 长度），:1273 `.slice(0, 2000)` 截断仍生效，但 args 被截断概率略增。优先 metadata 方案避免此问题。

## 非目标
- 不改前端 normalize.ts 的 ±3 窗口配对逻辑（属 task-14）。
- 不改 [TOOL_RESULT] emit 携带 tool_use_id（属 task-14 或后续 task；本任务只补 tool_use 侧）。
- 不改 tool_call JSON 的 `status`/`success` 字段语义（当前写死，后续可按 result 动态更新，超范围）。
- 不合并 stdout [TOOL_USE] 与 tool_call JSON 为单条 emit（design §5.3 说双写是故意的，人读 + 前端解析分离）。
- 不改 task-runner / service.py 的非 tool_use 分支（thinking/assistant/result/error 不动）。
- 不改 facade `service.py:219-232`（委托层）。
- 不加 DB migration（tool_use_id 存 AgentRunLog.metadata JSON 列或 content 文本，无新列）。

## TDD 步骤
1. **Red**：在 `sillyhub-daemon/src/__tests__/task-runner.tool-use-id.test.ts`（或现有测试文件）新增用例：mock SDK 事件 `content_block_start { type:'tool_use', id:'toolu_test123', name:'Bash', input:{command:'ls'} }` → 走 `_eventToMessages` 的 `case 'tool_use'`。断言：
   - 产出的 stdout message 含 `metadata.toolUseId === 'toolu_test123'`（或 content 含 `(toolu_test123)`）
   - 产出的 tool_call JSON message 的 content JSON.parse 后 `tool_use_id === 'toolu_test123'`
2. **Green**：按"实现要求"在 task-runner.ts:1250-1304 加 id 提取 + 字段注入，测试通过。
3. **Red**：补退化用例 —— mock `md.tool_use_id` / `md.id` 都为 undefined，断言 `toolUseId=''`、tool_call JSON 不含 `tool_use_id` 字段（或为 null）、stdout 行不带 id（回退原格式）。
4. **Green**：退化分支生效。
5. **Red**：在 `backend/app/modules/daemon/tests/test_wave5_integration.py` 的 `test_submit_messages_sdk_tool_use_block`（:419）扩展：mock 完整 SDK message 含 `content:[{type:'tool_use', id:'toolu_test456', name:'Read', input:{file_path:'/x'}}]`，调 `submit_messages`。断言：
   - 落库的 tool_call JSON 行 content parse 后 `tool_use_id === 'toolu_test456'`
   - stdout [TOOL_USE] 行含 id（metadata 或文本）
6. **Green**：在 run_sync/service.py:780-824 加 id 提取 + 字段注入，测试通过。
7. **Red**：补 batch / interactive 一致性用例 —— 同一 tool_use（id 相同）分别走 task-runner（batch）和 _extract_sdk_messages（interactive），断言两者产出的 tool_call JSON `tool_use_id` 一致。
8. **Green**：两路径对齐。
9. **回归**：跑 task-runner 现有 tool_use 测试 + `test_wave5_integration.py` 全套，确认现有 tool_use / tool_result / thinking 落库不受影响。
10. **手动验证**：抓真实 agent-run 日志（修复后重跑），grep tool_call JSON 行，确认含 `tool_use_id` 字段；grep stdout `[TOOL_USE]` 行，确认含 id（metadata 或文本）。

## 验收标准 (表格)
| 验收点 | 期望 | 验证方式 |
|---|---|---|
| task-runner tool_call JSON 含 tool_use_id | `JSON.parse(content).tool_use_id === 'toolu_xxx'` | 单测 mock SDK 事件 |
| task-runner stdout [TOOL_USE] 含 id | metadata.toolUseId 或文本 `(toolu_xxx)` | 单测 |
| service.py tool_call JSON 含 tool_use_id | 同上（interactive 路径） | 单测 mock SDK message |
| service.py stdout [TOOL_USE] 含 id | 同上 | 单测 |
| batch / interactive id 一致 | 同一 tool_use 两路径产出相同 tool_use_id | 对比单测 |
| 退化方案（SDK 无 id） | tool_use_id 字段省略/空，不崩 | 单测 mock 无 id |
| 字段命名统一 | 两路径均用 `tool_use_id`（snake_case） | 代码 diff |
| metadata 透传完整 | daemon → backend HTTP JSON 保留 metadata.toolUseId | 集成测试 / 抓包 |
| 现有 tool_use 落库不破坏 | 现有测试（test_submit_messages_sdk_tool_use_block）回归通过 | 跑回归 |
| stdout 文本不超长 | `.slice(0,2000)` 仍生效，id 加入后不超限 | 单测边界用例 |
