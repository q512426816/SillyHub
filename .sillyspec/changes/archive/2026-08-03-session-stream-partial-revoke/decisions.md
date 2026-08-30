---
author: WhaleFall
created_at: 2026-08-03T10:06:49
---

# 决策台账（Decisions）— daemon 会话实时流式回复「半截重复」修复

> 变更 `2026-08-03-session-stream-partial-revoke` · 本次变更的决策记录（非长期术语表）

## D-001@v1: 允许动后端（纯前端不可行）
- type: premise / boundary
- status: accepted
- source: user
- question: 彻底修复是否允许动后端？（初始约束「纯前端」）
- answer: 允许。链路查证证明纯前端不可行：daemon emit 带 `metadata.segmentId`，但 backend SSE 转发层（`service.py:434/464` continue 截断 override、`:595/:164` 不写 segment_id）彻底丢弃，前端 envelope（`daemon.ts:711`）无相关字段，巧妇难为无米之炊。用户确认允许动后端。
- normalized_requirement: backend `run_sync/service.py` 必须把 `segment_id` 透传到 session SSE envelope，并把 override 信号 publish 到 SSE（不落库）；前端据此撤回已渲染 partial。
- impacts: [FR-01, design §5 Phase1, 文件清单 service.py]
- evidence: explore 链路查证（daemon session-manager.ts:2702/2910 + service.py:405/434/464/595/164 + daemon.ts:711）；用户轮次确认「允许动后端（推荐）」
- priority: P0

## D-002@v1: 方案 A（透传 segmentId + override 撤回令箭）
- type: architecture
- status: accepted
- source: user
- question: 前端撤回半截靠什么触发？
- answer: 方案 A——backend 透传 `segment_id` + override 信号 publish（文本 `[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] <segmentId>`，不落库），前端 `classifySessionLog` 识别 override + `onLog` 维护 `segmentId→起点` Map 按 segmentId 精确撤回。优于方案 B（complete 自带 segmentId 替换，需改 task-14 落库语义 + 历史回看，风险高）与方案 C（override 走独立 event，新增事件类型，前端改动更大）。
- normalized_requirement: 撤回机制以 segmentId 为权威标识；override 不落库（保留 task-14 设计）；assistant + thinking 两种 override 都修。
- impacts: [FR-02, FR-03, design §5 Phase1/Phase2, 文件清单全部]
- evidence: daemon 流式语义查证（session-manager.ts:2702-2944：partial=增量片段 segmentId 非空、complete=全文 segmentId 空、override=撤回信号紧随 complete）；用户轮次确认「方案 A（推荐）」
- priority: P0

## D-003@v1: Design Grill 澄清（override 接法 + 透传字段 + DTO 边界）
- type: feasibility / consistency
- status: accepted
- source: design-grill
- question: design §12 自审存疑「service.py INSERT+publish 耦合，override publish-only 接法」；§9 表述「历史 log 返回 segment_id」是否成立？
- answer: (1) INSERT 与 publish 已解耦（submit_messages 返回纯标量 PublishIntent，router.py:1033 commit 后调 publish_submitted_messages 执行真正 publish），override envelope 直接 append 到 published_logs（跳 INSERT）即可复用现成两路 publish，无需 helper——存疑解决。(2) 透传 segment_id 必须用 `log_entry.segment_id`（complete 行 None），切勿用循环顶部局部变量 `segment_id`（complete 行也非 None，会误判）。(3) `AgentRunLogEntry` DTO（schema.py:161）不含 segment_id，本轮不加（守住不改 schema），历史路径不依赖该字段。
- normalized_requirement: override envelope append published_logs 跳 INSERT；透传用 log_entry.segment_id；DTO 不加 segment_id 字段（历史 GET 不返回）。
- impacts: [design §5.1.1 / §5.1.2 / §2.4 / §12, plan task]
- evidence: Design Grill X-02/X-03/X-11；service.py:710-726、router.py:1033、schema.py:161
- priority: P1
