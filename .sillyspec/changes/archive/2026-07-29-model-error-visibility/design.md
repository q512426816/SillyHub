---
author: qinyi
created_at: 2026-07-29T10:02:27
scale: large
risk_level: contract-required
---

# 设计文档（Design）— 模型调用失败可见性完整修复（claude code 会话）

## 1. 背景

平台 claude code 交互会话页面，当模型调用失败（GLM 429 额度耗尽、凭证无效、超时等）时，用户只看到「会话没反应」，完全看不到真实原因，只能靠查后端日志才能发现是额度耗尽。

实测证据链（均已复现）：

- claude 调模型失败 → daemon 能捕获，但只以 `channel=stdout` 纯文本记录到 run 日志：`[ASSISTANT] API Error: Request rejected (429) · [1310][您已达到每周/每月使用上限...]`。
- 后端 run 标记 `failed / is_error=true`（`interactive_run_closed` 事件），但错误详情只是那条 stdout 文本，**无结构化错误类型/原因**；session 状态仍显示 `active`。
- 前端 `frontend/src/components/agent-log/normalize.ts:352` 把所有 `[ASSISTANT]` 开头归为 `assistant` 类；只有 `channel=stderr` 才归 `error`（:355）。这条 API Error 被当成普通助手回复。
- 前端代码 grep "API Error" **零命中**——无任何模型调用失败的识别逻辑。
- 前端会话页面无「运行失败 → 显示原因」的错误态渲染。

结论：模型层失败从「被记录」到「用户可见」的链路是断的。这是错误可见性产品缺陷。

而**错误的原料其实 daemon 已经拿到了**：`sillyhub-daemon/src/adapters/stream-json.ts:902-904` 已提取 `is_error` + `resultText`（缓存 `lastResultInfo`），`stream-json.ts:866` 的 `api_retry` 事件带 `error` 字段，`hub-client.ts:530/540` 的 `notifyRunResult` 已实现 `result_summary`（非预留）。只是没归类成结构化错误传给后端。

## 2. 设计目标

1. 把模型调用失败（凭证/额度/超时/模型/网络等）归类成**结构化错误事件**，贯穿 daemon → backend → frontend。
2. 会话页面在 run 失败时，显示明确的「运行失败 + 原因 + 针对性建议 + 操作入口」。
3. 定义跨三端同构的 **ModelError 标准协议 + 类型枚举**，为多 agent 扩展打基础（本次仅实现 claude）。
4. 不回归现有成功路径与日志归一化（agent-log-display-fix 的 NOISE 折叠/去重不破坏）。

## 3. 非目标（Non-Goals）

- 不实现 codex/opencode/kimi 等其他 agent 的错误归类（架构预留 adapter classifier 扩展点，本次仅 claude）。
- 不做后台批量任务（task-runner）的失败可见性。
- 不自动恢复 / 不自动切换供应商（仅展示 + 手动 action）。
- 不改 `C:\Users\qinyi\daemon-start.bat` 的 GLM token（那是独立运维问题，本次只做「失败可见」，不解决 GLM 额度本身）。
- 不回填历史 failed run 的 error（仅新 run 生效；历史 run 无 error_detail，前端兜底「运行失败（无详情）」）。
- 不修 daemon 内存 session 重启丢失的既有缺陷（见 [[daemon-recovery-capability-boundary]]），但错误已落库持久，daemon 重连后仍可见。

## 4. 拆分判断

单变更：虽跨三端（daemon/backend/frontend），但内聚于「错误可见性」一条主线，无独立可交付的子集，不拆分。非批量模式（非「模板×数据」）。规模 = large（跨三端 + agent_run running→failed 状态转换 + 错误事件结构化 + schema/API/前端组件）。

## 5. 总体方案

定义跨三端同构的 ModelError 标准协议，让 claude 调用失败被归类成结构化错误，在会话页以「运行失败 + 原因 + 操作」呈现。分 5 个 Phase：

### Phase 1 — 标准错误协议（契约核心）
三端同构 `ModelError`：`type`（枚举）+ `code`（原始码）+ `message`（可读中文原因）+ `retryable` + `hint`（针对性建议）+ `raw`（原始错误文本）。关键：429 区分「额度耗尽 quota_exceeded（不可重试）」与「瞬时限流 rate_limited（可重试）」，依据错误文本判定。

### Phase 2 — daemon 归类器（近源）
新增 `sillyhub-daemon/src/model-error/classifier.ts`。输入 = claude 的 `is_error` + `subtype` + `resultText`（stream-json.ts:904）+ `api_retry.error`（stream-json.ts:866）+ 最近 assistant stdout。关键词/正则 → ModelError。按 agent 类型分发（claude 先实现，其他预留）。`notifyRunResult` payload 增 `error: ModelError`。

### Phase 3 — backend 存储 + 透传
`AgentRun` 加 `error_detail`（JSON 列，存完整 ModelError）+ alembic migration。`InteractiveRunResultRequest` 加 `error` 字段；`close_interactive_run` 接收写入；run → failed。`/sessions/{id}/runs` 返回 error_detail；SSE 推 error 事件。`pnpm gen:types` 同步 OpenAPI。

### Phase 4 — frontend 展示 + actions
新增 `RunErrorItem` 组件（消息流醒目错误卡片）：type→图标/颜色映射 + 「运行失败」标题 + message + hint + action 按钮。`normalize.ts`：run 有 error_detail 时生成 error 类日志项（不再误判 assistant）。actions：重新发送（重新 inject）/ 切换供应商（跳 llm-provider 设置）/ 查看详情（展开 raw）。run/session 状态 failed 标红。

### Phase 5 — 验证 + 回归
daemon classifier 单测 / backend migration+存储+API 测试 / frontend 组件 + normalize 测试 / 回归 agent-log-display-fix NOISE 折叠不误吞错误项 / e2e 复现（GLM 额度耗尽 → 看到错误项）。

## 6. 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/model-error/types.ts` | ModelError 类型 + ModelErrorType 枚举 |
| 新增 | `sillyhub-daemon/src/model-error/classifier.ts` | claude 错误归类器（关键词/正则 → ModelError） |
| 新增 | `sillyhub-daemon/src/model-error/index.ts` | 导出 |
| 新增 | `sillyhub-daemon/tests/model-error/classifier.test.ts` | 各错误类型用例单测 |
| 修改 | `sillyhub-daemon/src/adapters/stream-json.ts` | result is_error=true 时调 classifier，产出 ModelError |
| 修改 | `sillyhub-daemon/src/hub-client.ts` | `notifyRunResult` payload 增 `error` 字段 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | payload 映射（:1354-1397）带 error |
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | turn result 收尾携带 error |
| 修改 | `sillyhub-daemon/src/api-types.ts` | `pnpm gen:types`（InteractiveRunResultRequest 加 error） |
| 新增 | `backend/app/modules/daemon/model_error.py` | pydantic `ModelErrorDTO`（type/code/message/retryable/hint/raw） |
| 新增 | `backend/migrations/versions/xxxx_add_agent_run_error_detail.py` | alembic：AgentRun.error_detail（全局 versions/，down 接当前真实 head，防多 head） |
| 修改 | `backend/app/modules/agent/model.py` | AgentRun（:26）加 `error_detail`（JSON, nullable）；与既有 `error_code`（:113）分工（见 §8） |
| 修改 | `backend/app/modules/daemon/router.py` | InteractiveRunResultRequest（:1085）加 `error: ModelErrorDTO \| None`；路由 :1118 透传 error 形参；**新增** `GET /sessions/{id}/runs` 返回 error_detail；SSE（:1880）推 error 事件 |
| 修改 | `backend/app/modules/daemon/run_sync/service.py` | `close_interactive_run`（:735，真正实现）接收 error 写入 AgentRun.error_detail |
| 修改 | `backend/app/modules/daemon/service.py` | DaemonService facade `close_interactive_run`（:508）透传 error 形参 |
| 修改 | `backend/openapi.json` | `pnpm gen:types` 重新生成 |
| 新增 | `frontend/src/components/agent-log/run-error-item.tsx` | 错误项组件（图标/文案/hint/actions） |
| 新增 | `frontend/src/components/agent-log/__tests__/run-error-item.test.tsx` | 组件单测 |
| 修改 | `frontend/src/components/agent-log/normalize.ts` | run 有 error_detail → 生成 error 类日志项（:352 修正） |
| 修改 | `frontend/src/components/agent-log-viewer.tsx` | 渲染 RunErrorItem |
| 修改 | `frontend/src/lib/api-types.ts` | `pnpm gen:types` |
| 修改 | frontend 会话页面（agent/runtime 页组件） | 集成 RunErrorItem + run failed 状态 |
| 修改 | `.sillyspec/local.yaml` | modules 块加 daemon + agent 子模块条目（path+test；test 命令 plan 阶段按实际测试目录定），防 verify fallback 全量 |

## 7. 接口定义

### 7.1 ModelError 协议（三端同构）

```ts
// sillyhub-daemon/src/model-error/types.ts
type ModelErrorType =
  | 'auth_failed'      // 凭证失效/无效（401/403）
  | 'quota_exceeded'   // 额度/配额耗尽（429，不可重试）
  | 'rate_limited'     // 瞬时限流（429，可重试）
  | 'timeout'
  | 'model_not_found'
  | 'network'          // 连接失败/DNS
  | 'provider_error'   // 供应商其他错误（5xx）
  | 'unknown';         // 兜底

interface ModelError {
  type: ModelErrorType;
  code: string | null;     // 原始码（"1310"/"429"/null）
  message: string;         // 可读原因（中文）
  retryable: boolean;
  hint: string | null;     // 针对性建议
  raw: string | null;      // 原始错误文本（查看详情）
}
```

### 7.2 daemon classifier 签名

```ts
classifyModelError(input: {
  isError: boolean;
  subtype?: string;
  resultText?: string;      // stream-json lastResultInfo.resultText
  apiRetryError?: string;   // api_retry 事件 error 字段
  assistantStdout?: string; // 最近 [ASSISTANT] stdout（含 "API Error: ..."）
}): ModelError | null;      // null = 非模型错误（is_error=false 或非模型层）
```

归类规则（关键词/正则）：`API Error: Request rejected (429)` + `上限/quota` → quota_exceeded；`429` + `Too Many Requests/rate limit` → rate_limited；`401/403/invalid api key` → auth_failed；`timeout/timed out` → timeout；`model not found` → model_not_found；`ECONNREFUSED/ENOTFOUND` → network；`5xx/internal` → provider_error；兜底 unknown。

### 7.3 后端契约扩展

```python
# backend InteractiveRunResultRequest（daemon→backend）
class InteractiveRunResultRequest(BaseModel):
    status: str
    is_error: bool
    subtype: str | None = None
    result_summary: str | None = None
    error: ModelErrorDTO | None = None   # 新增
```

### 7.4 API 端点

- `POST /api/daemon/leases/{lease_id}/runs/{run_id}/result`（已有，router.py:1115；body 增 `error`）。
- `GET /api/daemon/sessions/{id}/runs`（**新增**端点；响应 run 项含 `error_detail`，供前端拉历史/当前 run 错误）。
- SSE `/api/daemon/sessions/{id}/stream`（既有，router.py:1880）：run 失败时推 error 事件（含 ModelError），实时。

## 7.5 生命周期契约表

本变更涉及 session / agent_run / daemon / lifecycle / state transition 关键词，必须含此表。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| run_failed_with_error | daemon（classifier） | backend `close_interactive_run` | run_id, lease_id, is_error=true, error{type,code,message,retryable,hint,raw} | AgentRun: running → failed；error_detail 填充 |
| error_event_push | backend | frontend（SSE） | run_id, error{type,...} | 前端 run → failed；渲染 RunErrorItem |
| retry_inject | frontend | backend → daemon | session_id, run_id, prompt | 新 AgentRun: created → running（复用现有 inject 链路） |

注：`claim lease` / `create session` / `submit message` / `session end` 等既有事件**不变**（见兼容策略）。

## 8. 数据模型

`AgentRun`（`backend/app/modules/agent/model.py:26`）新增一列：

```python
error_detail: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)
# 值 = ModelError 序列化 {type, code, message, retryable, hint, raw}；成功/无错误时为 None
```

**与既有 `error_code` 列分工**：`error_code`（agent/model.py:113，既有，如 `no_online_daemon`）保留供**调度层/系统错误**；`error_detail`（新增）专存**模型层** ModelError（claude 调模型失败）。两者正交，不互相覆盖。

alembic migration（`backend/migrations/versions/xxxx_add_agent_run_error_detail.py`，全局 versions/）：`add_column agent_runs.error_detail JSON NULL`（down 为 drop_column）。迁移链注意唯一 revision id + down 接真实 head（防多 head，见 [[migration-chain-fragmentation-pattern]]）。

## 9. 兼容策略（brownfield）

- **未配置/无错误时行为不变**：`is_error=false` 的成功 run 不产生 ModelError，error_detail=None，现有成功路径与日志归一化完全不受影响。
- **历史 run 兜底**：历史 failed run 无 error_detail，前端检测 `status==='failed' && !error_detail`（AgentRun 持久层无 is_error 列，以 status 判定）时显示「运行失败（无详情）」，不崩溃。
- **新旧混合**：`error` 字段在 daemon→backend 契约中可选（`| None`）；旧 daemon 不传 → 后端 error_detail=None → 前端兜底。旧后端不存 error_detail → 前端字段缺失时兜底。保证灰度不阻断。
- **不改既有 API/表结构**：仅新增一列 + 可选字段，不改动 claim/session/submit/end 既有事件与字段。

## 10. 风险登记（Risk Register）

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | claude 错误文本格式变化 → classifier 漏判 | P2 | 兜底 `unknown`，至少显示「运行失败」+ raw；classifier 用例覆盖已知格式 |
| R-02 | agent-log-display-fix 的 NOISE 折叠误吞错误项 | P1 | normalize 测试：error_detail 日志项不进 NOISE 折叠白名单；单测覆盖 |
| R-03 | 三端 ModelError 契约不一致（字段缺失） | P1 | `pnpm gen:types` 同步 + daemon/backend 契约测试 |
| R-04 | 多操作者并行改 daemon/backend（代码漂移） | P2 | 前端 tsc noUnusedLocals/typecheck 权威；execute 前 fetch 看远程领先 |
| R-05 | 429 quota vs rate_limited 误判（影响 retryable 建议） | P2 | 文本关键词优先；误判仅影响 hint 文案，不阻断 |
| R-06 | daemon 内存 session 重启丢失（既有缺陷）致 turn 收尾迟到 | P2 | error_detail 落库持久，daemon 重连/后端侧仍可据 is_error 补存；本次不修 session 持久化 |

## 11. 决策追踪

详见 `decisions.md`。当前版本决策及覆盖：

- **D-001@v1** 覆盖范围=claude 交互会话优先 → 覆盖 §3 非目标、§5 Phase 2 adapter 分发、FR-01。
- **D-002@v1** 展示形式=消息流错误项+状态失败 → 覆盖 §5 Phase 4、§7.5 error_event_push。
- **D-003@v1** 错误分类=细分类型+针对性提示 → 覆盖 §7.1 枚举、§7.2 归类规则、FR-02。
- **D-004@v1** 后续操作=重发/切换供应商/查看详情 → 覆盖 §5 Phase 4 actions、§7.5 retry_inject、FR-03。
- **D-005@v1** 技术方案=方案C 三端标准协议 → 覆盖 §5 全、§7 协议（非 daemon-only / 非 backend-parse）。
- **D-006@v1** 429 区分 quota_exceeded vs rate_limited → 覆盖 §7.1 枚举、§7.2 归类、retryable 语义。
- **D-007@v1** AgentRun 用 JSON 列 error_detail（非多列/非独立表） → 覆盖 §8 数据模型。
- **D-008@v1** Non-Goal：不改 GLM token、不回填历史、不自动恢复 → 覆盖 §3。
- **D-009@v1** error_code vs error_detail 分工 → 覆盖 §8（error_code 供调度层/系统错误；error_detail 供模型层 ModelError；正交不覆盖）。

无未解决决策。

## 12. 自审（Self-Review）

- **章节齐全**：1 背景 / 2 目标 / 3 非目标 / 4 拆分 / 5 方案 / 6 文件清单 / 7 接口 / 7.5 生命周期契约表 / 8 数据模型 / 9 兼容 / 10 风险 / 11 决策 / 12 自审 — ✅ 齐全。
- **生命周期契约表**：涉及 session/agent_run/daemon/lifecycle/state transition → 已含表，3 个事件（run_failed_with_error / error_event_push / retry_inject）均有对应代码+接口+测试任务（Phase 2/3/4 + §6 清单）。
- **决策覆盖**：D-001~009 全部映射到章节/FR；无未解决。
- **契约一致**：ModelError 三端同构字段（type/code/message/retryable/hint/raw）在 §7.1/§7.3/§8 一致；gen:types 保证。
- **YAGNI**：仅 claude（D-001），不过度铺多 agent；JSON 单列（D-007）而非独立表；不自动恢复（D-008）。
- **不影响 PPM**：仅动 daemon/backend daemon 模块/frontend，不碰 ppm。
- **成功路径不回归**：error 仅 is_error=true 时产生；§9 兼容策略保证兜底。
- ⚠️ 自审存疑：frontend 会话页面具体接入点（agent 页 vs runtime 页）需在 plan 阶段定位确切组件（execute 前确认）；local.yaml 加 daemon 模块条目需确认不与既有 backend 全量 test 冲突。
