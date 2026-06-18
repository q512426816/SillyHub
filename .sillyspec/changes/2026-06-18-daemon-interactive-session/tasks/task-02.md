---
id: task-02
title: 协议与 turn 调度契约（daemon/backend session 控制消息对齐）
wave: W2
priority: P0
depends_on: [task-01]
blocks: [task-03, task-04, task-07]
requirement_ids: [FR-02, FR-04, FR-05, FR-07, NFR-05]
decision_ids: [D-002@v2]
covers: [FR-02, FR-04, FR-05, FR-07, D-002@v2, NFR-05]
author: qinyi
created_at: 2026-06-18 15:31:03
allowed_paths:
  - sillyhub-daemon/src/protocol.ts
  - sillyhub-daemon/src/types.ts
  - backend/app/modules/daemon/protocol.py
  - sillyhub-daemon/tests/protocol.contract.test.ts
  - backend/app/modules/daemon/tests/test_protocol.py
---

# task-02 — 协议与 turn 调度契约

> 依据：`plan.md` task-02；`design.md` §5、§7.1、§9；`decisions.md` D-002@v2；`requirements.md` FR-02/FR-04/FR-05/FR-07、NFR-05。
>
> 回退约束：spike-01 未证明 Claude/Codex 可稳定使用同一长驻进程跨 turn 工作。本任务必须把 `inject` 定义为“请求执行 backend 已创建的下一 turn”，不得定义为向上一 turn 的 child/stdin 写入消息。

## 1. 目标

在 daemon TypeScript 与 backend Python 两端建立一致的 session 控制协议，为后续 task-03/task-04/task-07 提供唯一契约：

1. 新增 `SESSION_INJECT`、`SESSION_INTERRUPT`、`SESSION_END`、`PERMISSION_REQUEST`、`PERMISSION_RESPONSE` 五个消息常量。
2. 新增四组 payload 类型，并锁定字段名、方向、UUID JSON 表示和 permission 决策值域。
3. 明确 `SESSION_INJECT` 的 turn 调度语义：backend 已创建新的 AgentRun；daemon 收到消息后为该 `run_id` 独立 spawn，后续 turn 使用 agent 内部 session/thread id resume。
4. 通过跨文件契约测试直接比较 TS 与 Python 常量，避免只靠两份硬编码断言造成单边漂移。
5. 保持现有 batch lease、RPC、WS 信封和未知消息容错行为不变。

## 2. 真实源码基线

| 位置 | 当前事实 | 本任务动作 |
|---|---|---|
| `sillyhub-daemon/src/protocol.ts` | `MSG` 当前包含 task/heartbeat/lease/RPC 共 10 个值，使用 `as const` 导出 `MsgType` | 只追加五个消息常量，不改现有值 |
| `sillyhub-daemon/src/types.ts` | `DaemonMessage<T>` 的 `payload` 为 `unknown`；共享 payload 类型集中在本文件 | 新增四个 snake_case payload interface |
| `backend/app/modules/daemon/protocol.py` | 常量按 Server→Daemon / Daemon→Server 分组；payload 使用 Pydantic `BaseModel` | 同步新增常量与模型 |
| `sillyhub-daemon/tests/protocol.contract.test.ts` | 目前只用硬编码字符串验证 TS，未真正读取 Python 对端 | 改为同时解析 Python 常量并比较 |
| `sillyhub-daemon/src/ws-client.ts` | 非 RPC 合法 JSON 透传 `onMessage`；本层不做业务分派 | 本任务不修改，task-03 对未知业务 type 忽略 |

调用任何既有方法前继续用 `rg` 确认真实签名；不得根据旧 task-03 的长驻进程蓝图编造 API。

## 3. allowed_paths 与改动边界

执行阶段只能改 frontmatter `allowed_paths` 中列出的五个文件：

| 操作 | 路径 | 责任 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/protocol.ts` | 五个消息字面量与方向注释 |
| 修改 | `sillyhub-daemon/src/types.ts` | 四组 TS payload interface |
| 修改 | `backend/app/modules/daemon/protocol.py` | 五个 Python 常量与四组 Pydantic payload |
| 修改 | `sillyhub-daemon/tests/protocol.contract.test.ts` | TS 字面量、跨文件对齐、类型契约测试 |
| 新增 | `backend/app/modules/daemon/tests/test_protocol.py` | Pydantic 校验与 JSON 序列化测试 |

若实现需要修改 `ws-client.ts`、`daemon.ts`、`task-runner.ts`、router/service/model、adapter 或迁移，立即停止并回到对应 task；不得扩大本任务范围。

## 4. 消息常量契约

| TS key | Python constant | 字符串值 | 方向 | 语义 |
|---|---|---|---|---|
| `MSG.SESSION_INJECT` | `DAEMON_MSG_SESSION_INJECT` | `daemon:session_inject` | server → daemon | 请求执行已创建的新 turn；不是写旧进程 stdin |
| `MSG.SESSION_INTERRUPT` | `DAEMON_MSG_SESSION_INTERRUPT` | `daemon:session_interrupt` | server → daemon | 终止当前 turn，session 保持 active |
| `MSG.SESSION_END` | `DAEMON_MSG_SESSION_END` | `daemon:session_end` | server → daemon | 结束 session；若有 current run 则一并终止，随后完成 interactive lease |
| `MSG.PERMISSION_REQUEST` | `DAEMON_MSG_PERMISSION_REQUEST` | `daemon:permission_request` | daemon → server | 当前 turn 请求人工批准 |
| `MSG.PERMISSION_RESPONSE` | `DAEMON_MSG_PERMISSION_RESPONSE` | `daemon:permission_response` | server → daemon | 回答当前 turn 的 permission request |

规则：

- 消息值必须为小写 `daemon:<snake_case>`，两端逐字相同。
- 保留现有 `DaemonMessage { type, payload }` 信封，不增加第二套 envelope。
- `SESSION_INJECT` 名称为外部协议兼容名；其业务语义已由 D-002@v2 固定为 next-turn dispatch。
- 不新增 `TURN_START` 等同义消息，避免 backend 与 daemon 出现两种调度入口。

## 5. Payload 接口

### 5.1 TypeScript

在 `sillyhub-daemon/src/types.ts` 新增：

```typescript
export interface SessionInjectPayload {
  session_id: string;
  lease_id: string;
  run_id: string;
  prompt: string;
}

export interface SessionControlPayload {
  session_id: string;
  lease_id: string;
}

export interface PermissionRequestPayload {
  session_id: string;
  request_id: string;
  tool_name: string;
  input: Record<string, unknown> | string;
}

export interface PermissionResponsePayload {
  session_id: string;
  request_id: string;
  decision: 'allow' | 'deny';
}
```

字段必须保持 snake_case，因为它们是 WS JSON 契约，不做 camelCase 映射。

### 5.2 Python

在 `backend/app/modules/daemon/protocol.py` 新增同名 Pydantic 模型：

```python
from typing import Literal

class SessionInjectPayload(BaseModel):
    session_id: uuid.UUID
    lease_id: uuid.UUID
    run_id: uuid.UUID
    prompt: str

class SessionControlPayload(BaseModel):
    session_id: uuid.UUID
    lease_id: uuid.UUID

class PermissionRequestPayload(BaseModel):
    session_id: uuid.UUID
    request_id: str
    tool_name: str
    input: dict | str

class PermissionResponsePayload(BaseModel):
    session_id: uuid.UUID
    request_id: str
    decision: Literal['allow', 'deny']
```

### 5.3 字段语义

| Payload | 字段 | 语义 |
|---|---|---|
| `SessionInjectPayload` | `session_id` | 平台 AgentSession 主键，也是 daemon session 元数据 key |
|  | `lease_id` | 与该 session 1:1 的 interactive lease，用于消息归属校验 |
|  | `run_id` | backend 为下一 turn 新建的 AgentRun id；daemon 必须以它上报本 turn 日志/状态 |
|  | `prompt` | 下一 turn 输入；协议层保留原文，不改写、不拼接 stdin 帧 |
| `SessionControlPayload` | `session_id`, `lease_id` | interrupt/end 作用于 session 当前状态；具体 current run 由 session 元数据查找 |
| `PermissionRequestPayload` | `request_id` | 当前 turn 内唯一关联键，响应必须原样回填 |
|  | `tool_name`, `input` | provider 工具请求的透传信息；`input` 支持对象或字符串 |
| `PermissionResponsePayload` | `decision` | 仅允许 `allow`/`deny`；adapter 再映射各自协议值 |

`SessionInjectPayload.run_id` 是新 turn 的 id，不得复用上一个 turn 的 run id。`session_id` 也不得误用为 `AgentRun.session_id`；后者仍表示 agent 内部 resume id。

## 6. 边界场景（至少覆盖以下 8 项）

| 编号 | 场景 | 契约期望 | 归属 |
|---|---|---|---|
| B1 | `SESSION_INJECT` 到达且携带新 `run_id` | payload 可解析；后续按新 turn 调度 | 本 task 定义，task-03/04 执行 |
| B2 | 实现尝试把 inject prompt 写入上一 turn stdin | 明确禁止；上一 turn 进程已结束或正在独立运行 | D-002@v2 硬边界 |
| B3 | `session_id`/`lease_id`/`run_id` 非 UUID | Python Pydantic 校验失败 | 本 task 测试 |
| B4 | `prompt` 为空或仅空白 | 协议可表达；业务层 task-04 必须拒绝，不在协议模型偷偷 trim | task-04 |
| B5 | permission `decision` 为 `approve`/boolean/其他值 | Python 校验失败，TS 编译期不接受 | 本 task 测试 |
| B6 | permission `input` 为对象或字符串 | 两种形态都可序列化并保持原值 | 本 task 测试 |
| B7 | stale permission response 在 turn 结束后到达 | 协议仍可解析；task-07/08 必须按 `request_id` 判 stale 并忽略，不可写下一 turn stdin | 后续 task |
| B8 | 收到未知 WS `type` | 不崩溃、不断连；协议层不把 `MsgType` 当运行时校验器 | task-03 路由测试 |
| B9 | interrupt 时无 current run | payload 合法；业务层幂等返回/忽略，不得结束 session | task-03/04 |
| B10 | end 时存在 current run | payload 合法；业务层先终止 current run，再结束 session/lease | task-03/04 |

## 7. 非目标

- 不实现 sessionStore、turn runner、child process 生命周期、spawn、Claude `--resume` 或 Codex thread resume。
- 不实现 REST create/inject/interrupt/end、AgentRun 创建、placement、lease 状态迁移。
- 不实现 WS 控制消息 handler 或 `onControlMessage` 路由。
- 不实现 permission 暂停、stdin 回写、pending request 存储或审批 UI。
- 不实现 session SSE、多 AgentRunLog 聚合、Redis channel 或前端订阅。
- 不修改现有 batch lease、RPC 常量、`AgentRun.session_id` 或 quick-chat 行为。
- 不通过保留 child/stdin 跨 turn 来“兼容”旧 task-03；旧方案已被 D-002@v2 否决。

## 8. TDD 实施顺序

### Red

1. 先扩展 `sillyhub-daemon/tests/protocol.contract.test.ts`：
   - 断言五个 TS 字面量；
   - 读取 `backend/app/modules/daemon/protocol.py`，用稳定正则提取五个 `DAEMON_MSG_*` 值并逐项与 `MSG` 比较；
   - 断言 `Object.values(MSG)` 全部以 `daemon:` 开头；不要继续写死“8 个 MSG”这类过期计数；
   - 加编译期字面量赋值，确保 `as const` 未丢失。
2. 新增 `backend/app/modules/daemon/tests/test_protocol.py`：
   - 五个常量字面量；
   - 四种 payload 的有效构造与 `model_dump(mode="json")`；
   - UUID 输出为字符串；
   - 非法 UUID 与非法 decision 拒绝；
   - permission input 的 dict/string 双分支。
3. 运行定向测试，确认因常量/类型/模型尚未实现而失败。

### Green

4. 先在 backend `protocol.py` 添加常量和模型。
5. 再在 daemon `protocol.ts` 与 `types.ts` 添加完全对齐的常量和接口。
6. 运行定向测试直至通过，不改业务文件让测试“绕过”契约。

### Refactor / 回归

7. 清理重复字符串映射与过期“8 个 MSG”注释，保持 import 顺序和 formatter 输出。
8. 运行：

```powershell
Set-Location sillyhub-daemon
pnpm test -- protocol.contract
pnpm typecheck

Set-Location ../backend
uv run pytest app/modules/daemon/tests/test_protocol.py
```

9. 若环境允许，再运行 daemon 全量 `pnpm test` 与 backend daemon 模块测试；失败必须区分本任务回归和既有环境问题。

## 9. 验收表

| ID | 验收条件 | 自动化证据 |
|---|---|---|
| AC-02-01 | 五个新增消息在 TS/Python 两端逐字一致，方向注释正确 | `protocol.contract.test.ts` 跨文件比较 |
| AC-02-02 | `SESSION_INJECT` 文档和类型明确表示 backend 已创建下一 turn 的 `run_id`，没有任何长驻 stdin 语义 | 代码注释审查 + `SessionInjectPayload` 字段断言 |
| AC-02-03 | 四组 payload 字段名、必填性和值域对齐 | TS typecheck + Python payload pytest |
| AC-02-04 | Python UUID 以 JSON string 输出，daemon 可直接消费 | `model_dump(mode="json")` 测试 |
| AC-02-05 | permission 只接受 `allow`/`deny`，input 支持 dict/string | Python 正反例 + TS 字面量类型 |
| AC-02-06 | 现有 MSG/RPC/LEASE_STATE/路径断言继续通过 | daemon protocol contract 全量用例 |
| AC-02-07 | `MsgType` 仍为所有 `MSG` 值的字面量联合，未退化为 string | `pnpm typecheck` + 编译期赋值 |
| AC-02-08 | 本任务未修改 allowed_paths 外文件 | `git diff --name-only -- <allowed paths>` 与全局 diff 对照 |
| AC-02-09 | 未新增长驻 child/stdin、session runner 或业务 handler | diff 审查 |
| AC-02-10 | 定向 daemon 与 backend 测试通过 | 命令输出留证 |

## 10. 下游接口约束

- task-03 消费 `SESSION_*` 与 TS payload；收到 `SESSION_INJECT` 后必须启动独立 turn 进程，不能调用“写现有 stdin”的 API。
- task-04 在 inject REST 中先创建 AgentRun，再发送 `SessionInjectPayload`；并发或 active turn 冲突在业务层拒绝。
- task-07/08 使用 `request_id` 绑定当前 turn 的 permission；turn 结束时清理 pending request。
- task-05 以 `session_id` 聚合多个 `run_id`，不能把 protocol 的单个 run 当成整个 session。

## 11. 完成定义

- [ ] allowed_paths 内实现与测试已完成，未改其他文件。
- [ ] Red 阶段失败证据与 Green 阶段通过证据可追溯。
- [ ] `pnpm test -- protocol.contract` 通过。
- [ ] `pnpm typecheck` 通过。
- [ ] `uv run pytest app/modules/daemon/tests/test_protocol.py` 通过。
- [ ] 验收表 AC-02-01 至 AC-02-10 全部满足。
- [ ] task-03/task-04 可仅依赖本文件定义，不再引用旧“长驻 stdin 注入”方案。
