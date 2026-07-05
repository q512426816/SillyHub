---
id: task-12
title: "[D1/D2][backend] submit_messages 落库按 segmentId 去重 thinking"
priority: P1
depends_on: [task-11]
blocks: []
requirement_ids: [FR-07, FR-08]
decision_ids: [D-002@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\run_sync\service.py
author: qinyi
created_at: 2026-06-22T21:19:09
---
# task-12: [D1/D2][backend] submit_messages 落库按 segmentId 去重 thinking

## 修改文件
- `C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\run_sync\service.py`
  - 第 48-136 行：`submit_messages` 主体 —— 循环 `flat_messages` 写 `AgentRunLog`（:120-127 INSERT）、提取 usage/session_id、Redis publish
  - 第 83-91 行：`flat_messages` 构造 —— 顶层有 `event_type`/`content` 的原样透传，否则调 `_extract_sdk_messages` 展开
  - 第 691-850 行：`_extract_sdk_messages(msg)` —— 完整 SDK assistant message 展开为 flat records；第 766-778 行 `btype==='thinking'` 展开全文 `[THINKING] <text[:2000]>`（这是重复来源 B：完整段）
  - 第 780-824 行：`btype==='tool_use'` 双 emit（`[TOOL_USE]` stdout + `tool_call` JSON，属 task-13 范围，本任务不动）

**注意（daemon-service-split 后的真实路径）**：design.md §5.3 引用的 `service.py:3329-3488`（`_extract_sdk_messages`）/ `service.py:1088-1290`（`submit_messages`）/ `service.py:1159-1167`（AgentRunLog INSERT）是拆分前的旧路径。daemon-service-split 已把这两个方法迁到 `backend/app/modules/daemon/run_sync/service.py`，`backend/app/modules/daemon/service.py:219-232` 只剩 facade 委托（`return await self._run.submit_messages(...)`）。本任务改 `run_sync/service.py`，**不改 facade**。

## 覆盖来源 (design.md §5.3 / requirements.md FR-07 FR-08)
- design.md §5.3 根因：backend `_extract_sdk_messages`（旧 service.py:3329-3488，现 run_sync/service.py:691-850）完整 message 展开全文 [THINKING]，与 daemon 已 flush 的 partial 行重复。
- design.md §5.3 修复 2：`_extract_sdk_messages` 完整 message 展开全文 [THINKING] 时，如检测该段已有 partial 落库，标记去重；`submit_messages` 落库按 segmentId 去重（完整优先，丢弃同 segment 的 partial）。
- design.md §6 数据模型：`AgentRunLog` 落库逻辑（旧 service.py:1159-1167，现 run_sync/service.py:120-127）增加 thinking segment 去重判断（应用层逻辑，非 DDL）；无 schema 迁移。
- design.md §9 兼容：无 DB 新字段则应用层去重（不写已覆盖的 partial）。
- requirements.md FR-07：[THINKING] 不再逐 token 碎片化。
- requirements.md FR-08：同一思考内容只出现一次。
- task-11 前置：daemon 已在 partial message 加 `metadata.segmentId` + `metadata.isPartial:true`，完整 message 后跟 `[THINKING_OVERRIDE] <segmentId>` 信号（或完整 message 携带 completed segment 列表）。

## 实现要求 (编号步骤)
1. **解析 daemon 透传的 segmentId**：在 `submit_messages`（:48）的 message 循环里，daemon 发来的 flat message 可能携带 `metadata` 字段（dict）。提取：
   ```python
   metadata = msg.get("metadata") if isinstance(msg, dict) else None
   segment_id = metadata.get("segmentId") if isinstance(metadata, dict) else None
   is_partial = bool(metadata.get("isPartial")) if isinstance(metadata, dict) else False
   ```
   注意：当前 `flat_messages` 构造（:83-91）只看 `event_type`/`content`，需扩展保留 `metadata` 字段透传到 `AgentRunLog.metadata`（JSON 列，已存在）。
2. **识别 [THINKING_OVERRIDE] 信号**：在 message 循环里，若 `content` 以 `[THINKING_OVERRIDE] ` 开头（task-11 定义），解析出 `segmentId`，加入 `completed_segments: set[str]`（本次 submit_messages 调用内的局部集合）：
   ```python
   if content.startswith("[THINKING_OVERRIDE] "):
       seg = content[len("[THINKING_OVERRIDE] "):].strip()
       completed_segments.add(seg)
       continue  # 信号本身不落库
   ```
   退化方案：若 daemon 不发 override 信号（task-11 退化分支），改为从完整 assistant message 的 metadata 提取 `completedSegments` 列表。
3. **`_extract_sdk_messages` 完整 thinking 标记 segmentId**：在 :766-778 `btype === 'thinking'` 分支，给产出的 flat record 加 `segmentId`（用 `${msg.message.id}:${block_index}` 或退化 `turnMsgId:thinking`）：
   ```python
   msg_id = inner.get("id") or msg.get("message_id") or "unknown"
   segment_id = f"{msg_id}:{idx}"  # idx 是 content blocks 数组的下标
   out.append(stamp({
       "event_type": "text",
       "content": f"[THINKING] {preview}",
       "channel": "stdout",
       "metadata": {"thinking": True, "segmentId": segment_id, "isComplete": True},
   }))
   ```
   其中 `idx` 是 `for idx, b in enumerate(blocks):` 的循环变量（现有 :748 是 `for b in blocks:`，改为 `for idx, b in enumerate(blocks):`）。
4. **落库去重逻辑**：在 :120 `AgentRunLog(...)` INSERT 之前，判断：
   ```python
   if segment_id and is_partial and segment_id in completed_segments:
       # 该 segment 的完整行已落库（或即将落库），丢弃 partial
       continue
   if segment_id and not is_partial and segment_id in flushed_partial_segments:
       # 完整行到达，但同 segment 的 partial 已落库 —— 完整优先，删除旧 partial
       # （或标记 partial 为 stale，前端忽略）
       # 简化：完整行照常 INSERT，同时记录 segment_id 到 AgentRun.metadata
       # 已落库的 partial 靠前端 normalize 覆盖（本任务不回删 DB）
       pass
   ```
   `flushed_partial_segments: set[str]` 记录本次调用内已见 partial 的 segment（循环中累积）。
5. **AgentRunLog.metadata 落盘 segmentId**：`AgentRunLog` 有 `metadata` JSON 列（确认：读 `backend/app/modules/daemon/models.py` 或 alembic migration，若不存在则用 `content` 前缀标记退化）。INSERT 时写入：
   ```python
   log_entry = AgentRunLog(
       id=log_id, run_id=agent_run_id, timestamp=now,
       channel=channel, content_redacted=content[:5000],
       metadata={"segmentId": segment_id, "isPartial": is_partial} if segment_id else None,
   )
   ```
   **execute 必须先确认 `AgentRunLog` 模型是否有 `metadata` 列**（grep `class AgentRunLog` 定义）；若无，退化方案：content 前缀加不可见标记 `\x00<segmentId>\x00`（不推荐，污染文本）或单独加列（违反"无 migration"约束，需升级 design）。
6. **跨 submit_messages 调用的去重**：partial 和完整 message 可能在不同 `submit_messages` 调用（daemon 分批 HTTP）。局部 `completed_segments` 集合跨调用失效。**方案**：查 DB —— 完整行 INSERT 前查 `SELECT 1 FROM agent_run_logs WHERE run_id=? AND metadata->>'segmentId'=? AND metadata->>'isPartial'='false'`，若存在则跳过 partial；或反之 partial 先到，完整行到达时 DELETE 同 segment 的 partial 行（软删：UPDATE content='[STALE]...'）。**优先简化方案**：不跨调用查 DB，接受偶发重复（前端 normalize 兜底覆盖），仅做单次调用内去重。

## 接口定义 (函数签名/DTO)
- `submit_messages` 签名不变（:48-54）。
- `_extract_sdk_messages` 返回值扩展：每个 record 可选携带 `metadata: dict`（含 `segmentId`/`isComplete`/`isPartial`）。
- `AgentRunLog` INSERT 新增字段（若模型支持）：`metadata: dict | None`。
- `[THINKING_OVERRIDE] <segmentId>` 消息格式（daemon → backend，task-11 定义）。

## 边界处理 (≥5条)
1. **partial 先到、完整后到（常见）**：同一次 `submit_messages` 调用内，partial 先入循环被 INSERT，完整行后到时 `segment_id in flushed_partial_segments` —— 简化方案：完整行照常 INSERT（接受 DB 里 partial + 完整并存），前端 normalize 用 `isComplete` 覆盖 `isPartial`。若要严格去重，完整行 INSERT 时 DELETE 同 segment partial（额外 SQL，性能权衡）。
2. **完整先到、partial 后到**：partial 到达时 `segment_id in completed_segments`（本调用内已见完整行）→ continue 跳过。跨调用则查 DB（简化方案不查，接受重复）。
3. **segmentId 透传完整性**：daemon → backend HTTP JSON 必须保留 `metadata.segmentId`（不能在序列化丢失）。execute 验证 daemon 发的 JSON 是否含 metadata 字段（task-11 已加）；backend 反序列化后 `msg.get("metadata")` 能取到。
4. **无 DB 新字段退化**：若 `AgentRunLog` 无 `metadata` 列，应用层在 `content` 里嵌入标记（如 `[THINKING][seg=xxx,partial] <text>`），前端 normalize 解析。但这污染文本，**优先确认模型有 metadata 列**（execute 第一步 grep 模型定义）。
5. **[THINKING_OVERRIDE] 信号不落库**：信号本身只是通知，`continue` 跳过 INSERT（:114 已有 `if not content: continue` 模式可参照）。信号只在本次调用的 `completed_segments` 集合生效。
6. **非 thinking message 不受影响**：`[ASSISTANT]` / `[TOOL_USE]` / `[TOOL_RESULT]` 无 segmentId（或独立逻辑），去重只对 `[THINKING]` 生效。判断条件：`content.startswith("[THINKING] ")` 且有 `segment_id`。
7. **批量 message 原子性**：一次 `submit_messages` 收到 N 条 message（含 partial + 完整 + override），`completed_segments` 在循环内累积，循环结束后统一 commit（:171）。若中途异常，整批回滚，无部分落库的脏数据。
8. **Redis publish 一致性**：`published_logs`（:129-136）只含实际落库的 message，被去重跳过的 partial 不 publish（前端 SSE 不会收到脏数据）。完整行照常 publish。

## 非目标
- 不改 `_extract_sdk_messages` 的 tool_use 双 emit（属 task-13）。
- 不加 DB migration / 新列（应用层去重，metadata 列若已存在则用，不存在则退化）。
- 不回删历史 AgentRunLog 的重复 thinking 行（只对新写入去重）。
- 不改前端 normalize.ts（前端覆盖展示是独立 task）。
- 不改 `submit_messages` 的 usage/session_id 提取逻辑（:100-112）。
- 不改 facade `service.py:219-232`（委托层）。
- 不处理 assistant（非 thinking）文本的去重（`_extract_sdk_messages` 的 `btype==='text'` 分支 :753-764 不动）。

## TDD 步骤
1. **Red**：在 `backend/app/modules/daemon/tests/test_wave5_integration.py`（已有 `test_submit_messages_sdk_thinking_block` 在 :374）扩展或新增用例：mock daemon 发来 partial message（`metadata.segmentId='msg1:0', isPartial=True`）+ 完整 message（含 thinking block，`_extract_sdk_messages` 产出 `segmentId='msg1:0', isComplete=True`）。断言：
   - `AgentRunLog` 表中 `segmentId='msg1:0'` 只剩完整行（isComplete=True），partial 行被跳过（同调用内）
   - 或两者并存但 metadata 字段正确（简化方案）
2. **Green**：按"实现要求"加 segmentId 解析 + 去重判断，测试通过。
3. **Red**：补 `[THINKING_OVERRIDE]` 信号用例 —— message 列表含 override 信号，断言信号不落库、`completed_segments` 生效、后续同 segment partial 被跳过。
4. **Green**：override 信号解析生效。
5. **Red**：补完整先到 partial 后到用例（同调用内乱序），断言 late partial 被跳过。
6. **Green**：乱序场景通过。
7. **Red**：补跨调用去重用例 —— 第一次 submit_messages 落 partial，第二次 submit_messages 落完整行（同 segment），断言（简化方案）：两者并存但 metadata 正确；（严格方案）：完整行到达时 DELETE 旧 partial。
8. **Green**：跨调用场景通过（按选定方案）。
9. **回归**：跑 `test_wave5_integration.py` 全套（:251-770），确认现有 `test_submit_messages_sdk_thinking_block` / `test_submit_messages_sdk_tool_use_block` / usage 提取等用例不受影响。
10. **确认模型**：`grep -n "class AgentRunLog" backend/app/modules/daemon/models.py` 确认有 `metadata` 列；若无，升级到 design（加 migration）或走退化方案（content 标记）。

## 验收标准 (表格)
| 验收点 | 期望 | 验证方式 |
|---|---|---|
| 同 segment 单调用内去重 | partial + 完整同 segment 时只落库完整行 | 单测查 AgentRunLog 计数 |
| [THINKING_OVERRIDE] 信号不落库 | 信号 message 不进 AgentRunLog 表 | 单测 |
| segmentId 透传到 AgentRunLog.metadata | 落库行的 metadata 含 `segmentId` + `isPartial`/`isComplete` | 查 DB |
| 完整行优先于 partial | 同 segment 两者并存时前端可据 isComplete 覆盖 | metadata 字段 |
| 不引入 DB migration | 应用层去重，不改表结构（metadata 列已存在则用） | grep alembic versions 无新增 |
| 非 thinking message 不受影响 | [ASSISTANT] / [TOOL_USE] 落库行数不变 | 现有测试回归 |
| usage/session_id 提取不变 | :100-112 逻辑不受去重影响 | 现有 usage 测试回归 |
| Redis publish 一致 | 被跳过的 partial 不进 published_logs / SSE | 单测 spy publish |
| _extract_sdk_messages thinking 带 segmentId | 完整 thinking 行输出含 metadata.segmentId + isComplete | 单测直接调 _extract_sdk_messages |
