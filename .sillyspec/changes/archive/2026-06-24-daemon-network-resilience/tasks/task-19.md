---
id: task-19
title: protocol SubmitMessagesBody.messages[].dedup_key（sillyhub-daemon + backend 透传）
priority: P0
wave: W3
depends_on: []
blocks: [task-21, task-23]
requirement_ids: [FR-08]
decision_ids: [D-001@v2]
allowed_paths:
  - sillyhub-daemon/src/protocol.ts
  - backend/app/modules/daemon/schema.py
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-19: protocol dedup_key 透传

> 来源：design.md §5 Phase3 protocol / §9 兼容（可选字段）；plan.md Wave3 task-19。D-001@v2。
> 本质：SubmitMessages 请求体 messages[] 加可选 `dedup_key`。sillyhub-daemon protocol.ts 类型 + backend schema.py 透传。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/protocol.ts` | SubmitMessagesBody.messages 元素类型加 dedup_key |
| 修改 | `backend/app/modules/daemon/schema.py` | SubmitMessages 请求 messages 透传 dedup_key（dict 字段，Pydantic 不强约束） |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-08 | protocol 透传 dedup_key | 两端 schema |

## 实现要求

1. **sillyhub-daemon protocol.ts**：SubmitMessagesBody 的 messages 类型元素加 `dedup_key?: string`。
2. **backend schema.py:173**：`messages: list[dict]`（已是无类型 dict，dedup_key 自然透传，无需改类型；确认 router/service 取 message['dedup_key'] 可用）。如需强类型可定义 MessageIn(BaseModel) 含 dedup_key: str | None，但 list[dict] 已够透传，本 task 保持 list[dict] + 注释说明 dedup_key 可选。
3. **hub-client.submitMessages**：现有 body 直接 `{ messages }` 透传（hub-client.ts:370），envelope.message 已含 dedup_key（调用方包装），确认 submitMessages 传的是 message（含 dedup_key）——注意 task-08 submitWithRetry 传 `envelopes.map(e=>e.message)`，dedup_key 应在 message 内还是 envelope 顶层？**统一**：dedup_key 放 message 顶层字段（`message.dedup_key`），backend 从 `msg.get('dedup_key')` 取。envelope.dedup_key 仅 daemon 内部用（outbox markDelivered），提交时把 dedup_key 写入 message 顶层。

## 接口定义

```ts
// protocol.ts
interface SubmitMessage { /* 现有字段 */ dedup_key?: string; }
interface SubmitMessagesBody { claim_token: string; agent_run_id: string; messages: SubmitMessage[]; }
```

backend：message dict 含 `dedup_key: str | None`，submit_messages（task-21）取 `msg.get('dedup_key')` 写 AgentRunLog。

## 边界处理

1. **可选字段**：旧 daemon 不发 dedup_key → backend 当 None（兼容）。
2. **dict 透传**：backend list[dict] 不强约束，dedup_key 缺失不报错。
3. **dedup_key 位置**：统一 message 顶层（backend 取 msg['dedup_key']）。
4. **参数不可变**。
5. **跨子项目一致**：两端字段名 dedup_key（snake_case）。

## 非目标

- 不实现 backend 写入去重（task-21）。
- 不改 AgentRunLog 列（task-20）。
- 不强类型 backend message（保持 list[dict] 灵活）。

## 参考

- sillyhub-daemon protocol.ts / hub-client.ts:360-375 submitMessages
- backend schema.py:173
- design.md §5 Phase3 / §9

## TDD 步骤

1. 写测试：daemon submit 带 dedup_key → backend 收到 message.dedup_key；不带 → None。
2. 确认失败。
3. 实现类型 + 注释。
4. `cd sillyhub-daemon && pnpm test` + `cd backend && uv run pytest` 通过。
5. 回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | protocol 类型含 dedup_key | SubmitMessage 有 dedup_key? |
| AC-02 | backend 透传 | message dict 含 dedup_key 可取 |
| AC-03 | 可选兼容 | 不带 dedup_key 不报错 |
| AC-04 | 测试全绿 | daemon + backend 测试通过 |
