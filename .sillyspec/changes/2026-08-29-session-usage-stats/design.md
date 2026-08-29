---
author: qinyi
created_at: 2026-08-29 12:52:41
scale: large
tier: independent
risk_level: contract-required
---

# 设计文档（Design）— 会话内 Token 用量统计展示

## 背景

用量统计细化到供应商×模型（change 2026-08-29-usage-by-provider-model）后，平台侧已有按 runtime 的用量聚合（`GET /runtimes/usage`，运行时页用量卡），但**会话维度没有用量视图**：用户在会话里聊了半天，看不到这个会话累计消耗了多少输入/输出/缓存 token、调用了多少次模型 API、缓存命中率如何。数据面已经齐备——`agent_run_model_usage` 明细表（run×模型四维+api_requests）+ `AgentRun` 四维 token 列（`input_tokens`/`output_tokens`/`cache_read_tokens`/`cache_creation_tokens`，老 run 兜底源；注意 `ctx_tokens` 是「最近一次调用提示词大小」快照列，**不参与**用量求和）——只缺会话级聚合出口与前端展示。

## 设计目标

1. 会话内可见本会话累计用量：输入、输出、缓存读取、缓存写入、请求次数五指标 + 缓存命中率（D-003 口径：`cache_read/(cache_read+input)`，分母 0 显示「—」）。
2. page 会话详情页与 dialog 浮窗对话**双模式同构展示**（D-001），单一组件复用。
3. 会话级汇总常驻 + 按模型折叠明细（D-002，交互对齐运行时页用量卡先例），覆盖会话中途切模型场景。
4. 数字随每轮结束自动刷新（SSE 轮次终态事件触发），无需手动刷新页面。

## 非目标（Non-Goals）

- 不做金额/计费折算（套餐口径与平台口径可能不一致，运行时页已有 footnote 先例，本轮不引入成本字段）。
- 不做跨会话/工作区级汇总（运行时页 `/runtimes/usage` 已覆盖全局视角）。
- 不做实时逐 token 更新（数据粒度=轮次终态落库，展示粒度随之）。
- 不改 daemon 侧任何代码（数据已由既有终态上报链路落库）。
- 不做新迁移（复用既有表，零 schema 变更）。

## 拆分判断

单一功能模块（一个聚合端点 + 一个展示组件），前后端两域耦合紧密（DTO 契约驱动），不满足拆分条件（<3 个可独立交付模块、无多角色视图、无跨页面状态流转）；任务数 <10，无批量模式诉求。单变更推进，Wave 按 后端→前端→收口 排。

## 决策与方案选择

详细记录见 `decisions.md`（D-001~D-004，均为用户 AskUserQuestion 确认）：

- **D-001@v1 展示位置**：page 会话详情页 + dialog 浮窗双模式同构展示，单一组件复用（否决「仅 page」「仅 dialog」）。
- **D-002@v1 展示粒度**：会话级汇总常驻 + 按模型折叠明细（否决「仅汇总」——会话中途切模型后无从分辨各模型消耗）。
- **D-003@v1 命中率口径**：`cache_read / (cache_read + input)`（业界 prompt cache 常用口径；否决「分母含 cache_creation」的严格覆盖率口径）。分母 0 显示「—」。
- **D-004@v1 数据链路方案**：方案 A——新增 `GET /api/daemon/sessions/{id}/usage` 聚合端点（明细表为主 + AgentRun 四维列兜底）；否决方案 B（塞进会话详情——响应膨胀、分组明细无处安放）与方案 C（前端聚合轮次列表——已核实 `SessionRunRead` 仅输入/输出两维，数据面不成立）。

方案 A 的衍生技术裁定（Design Grill 复审通过）：组件自取数（useEffect + refreshSignal prop）而非 react-query，规避 dialog 渲染路径零 QueryClientProvider 约束。

## 总体方案

**Wave 1（backend 聚合与端点）**：`session/service.py` 新增 `get_session_usage` 聚合函数——两段查询合并结果：
1. 明细聚合（主源）：`agent_run_model_usage` JOIN `agent_runs`（`agent_session_id = :sid`）GROUP BY `model`，SUM 四维 + `api_requests`；
2. 兜底聚合：该会话中**没有任何明细行**的 run（2026-08-29 之前的历史轮次），SUM `AgentRun` 表上四维 token 列（`ctx_tokens` 快照列显式排除），model 取 `run.model`（NULL → 「未记录」桶），`api_requests` 无来源按 0 计（诚实值，前端脚注说明）。
`totals` = 两段之和；`by_model` 按 input+output 总量降序（模型行无分组层级，此排序为本变更新定规则——先例 `sortProviderUsage` 是供应商分组内按名排序，维度不同）。「未记录」桶恒排末位。router 新增 `GET /api/daemon/sessions/{session_id}/usage`，归属校验对齐既有会话端点（`session.user_id != user.id` 或不存在 → 404 resource-hiding）。

**Wave 2（frontend 组件与接线）**：新组件 `session-usage-bar.tsx`（摘要行 + 可折叠按模型明细表，原型 `prototype-session-usage.html` 为视觉基准）。组件**自取数**：内部 `useEffect` 调 `lib/daemon.getSessionUsage`（不依赖 react-query——dialog 渲染路径是零 react-query 约定，session-panel.tsx 文件头明言且 3 套弹窗测试无 QueryClientProvider，不能为其引入 Provider 依赖）；刷新经 `refreshSignal?: number` prop——父层在轮次终态处理点递增该计数触发重取（page 模式挂既有 `onTurnCompleted` 处理点，dialog 模式挂其轮次终态处理点）。`session-panel.tsx` page 模式（会话头部下方）与 dialog 模式（输入框上方）两处渲染点接线。

**Wave 3（类型与回归收口）**：`pnpm gen:types` 同步 `api-types.ts` + `backend/openapi.json`；三端相关测试回归。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/schema.py | 新增 `SessionUsageModelItemRead` / `SessionUsageRead` DTO。数据流：producer=`session/service.get_session_usage`（SQL SUM 结果）→ router `response_model` 序列化 → consumer=前端 `api-types.ts` 生成物（gen:types） |
| 修改 | backend/app/modules/daemon/session/service.py | 新增 `get_session_usage(session_id, user_id)` 聚合方法（明细 JOIN 聚合 + 无明细 run 四维列兜底——`ctx_tokens` 快照列排除，含归属校验复用） |
| 修改 | backend/app/modules/daemon/router.py | 新增 `GET /sessions/{session_id}/usage` 端点（owner-only 404 resource-hiding，对齐既有会话端点） |
| 新增 | backend/app/modules/daemon/tests/test_session_usage.py | 聚合正确性（纯明细/纯兜底/混合/空会话/多模型排序）+ 归属 404 用例 |
| 新增 | frontend/src/components/daemon/session-usage-bar.tsx | 用量条组件（摘要行+折叠明细；命中率前端算，D-003 口径注释锚定）。自取数：useEffect 调 `getSessionUsage`，`refreshSignal` prop 触发重取；不依赖 react-query（dialog 零 react-query 约束）。数据流：consumer ← `lib/daemon.getSessionUsage` ← api-types `SessionUsageRead` |
| 新增 | frontend/src/components/daemon/__tests__/session-usage-bar.test.tsx | 组件渲染用例（数字/命中率分母 0 →「—」/折叠交互/refreshSignal 重取/双模式渲染点） |
| 修改 | frontend/src/lib/daemon.ts | 新增 `getSessionUsage(sessionId)` API 封装 |
| 修改 | frontend/src/components/daemon/session-panel.tsx | page/dialog 双模式渲染点接线 + 轮次终态处理点递增 refreshSignal（page 挂 onTurnCompleted 既有位置；dialog 挂其轮次终态处理位置） |
| 修改 | backend/openapi.json + frontend/src/lib/api-types.ts | gen:types 生成物同步（新增 `SessionUsageRead` schema） |

## 接口定义

```python
# backend/app/modules/daemon/schema.py
class SessionUsageModelItemRead(BaseModel):
    model: str                          # 模型名；兜底桶 = run.model 或 "未记录"
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    api_requests: int = 0               # 兜底桶恒 0（无来源，诚实值）

class SessionUsageRead(BaseModel):
    totals: SessionUsageModelItemRead   # 五指标汇总（明细+兜底之和）
    by_model: list[SessionUsageModelItemRead] = []  # input+output 降序；「未记录」恒末位
```

```python
# GET /api/daemon/sessions/{session_id}/usage → 200 SessionUsageRead
# 归属：session 不存在或 user_id != principal → 404（resource-hiding）
```

```tsx
// frontend session-usage-bar.tsx props
interface SessionUsageBarProps { sessionId: string; refreshSignal?: number }
// 自取数：useEffect([sessionId, refreshSignal]) → getSessionUsage → 本地 state；无 react-query 依赖
// 命中率（展示层派生，不入 DTO）：
// hitRate = cache_read + input > 0 ? cache_read / (cache_read + input) : null（null → 显示「—」）
```

聚合 SQL 语义（get_session_usage）：两段均以 `agent_runs.agent_session_id = :sid` 为锚；明细段 `JOIN agent_run_model_usage mu ON mu.run_id = agent_runs.id GROUP BY mu.model`；兜底段 `agent_runs.id NOT IN (SELECT run_id FROM agent_run_model_usage WHERE run_id IN (会话 runs))` 后按 `COALESCE(model, '未记录')` 归并求和（SUM 仅四维 token 列，`ctx_tokens` 排除）。SQLAlchemy select 实现，不用 Python 侧循环取 run 列表（大会话防 IN 膨胀）。

## 生命周期契约

不涉及生命周期契约——本变更为纯只读聚合查询与展示，不改任何 session/lease/agent_run 状态机、不新增事件。

## 测试与验收

- backend：`test_session_usage.py`——①纯明细聚合（多 run 多模型，SUM 正确、排序正确）；②纯兜底（无明细行老 run，四维并入、api_requests=0、「未记录」桶）；③混合（明细+兜底并存，totals=两者和）；④空会话/全零会话（200，五指标全 0，by_model 空）；⑤归属（他人会话 404、不存在 404、缺鉴权 401）。
- frontend：`session-usage-bar.test.tsx`——①摘要行五指标+命中率渲染（含百分比格式）；②分母 0 命中率显示「—」；③折叠/展开明细表交互；④session-panel 双模式渲染点各挂一处（page 头部下方/dialog 输入框上方）；⑤refreshSignal 递增触发重新拉取（mock getSessionUsage 调用次数断言，无 QueryClientProvider——对齐 dialog 零 react-query 约束）。
- 验收：真实会话（含 08-29 前历史轮次 + 后新轮次）打开详情页/浮窗，数字与 DB 手工 SUM 一致；每轮结束数字自动更新；tsc 0 错、相关测试全绿。

## 风险与权衡

- **R-01 兜底桶 api_requests=0**：老 run 无调用次数字段，强行按 run 数估会污染口径——按 0 计并以脚注声明（对齐 by_provider「未记录」先例）。
- **R-02 命中率双处口径漂移**：会话级与模型级同公式，前端单一工具函数派生（组件内私有 helper，注释锚定 D-003），不复制公式。
- **R-03 大会话查询**：聚合在 SQL 侧完成（JOIN/GROUP BY），不拉 run 明细行进内存；会话 runs 量级=轮次数（几十~几百），索引 `agent_runs.agent_session_id` 既有。
- **R-04 刷新时机与 dialog 约束**：session-panel dialog 渲染路径为零 react-query 约定（文件头声明，3 套弹窗测试无 Provider）——组件因此自取数（useEffect）+ `refreshSignal` prop 重取，不引入 QueryClientProvider 依赖；page 模式同样走 refreshSignal（单一实现双模式）。信号丢失时下次任意轮终态/页面刷新自然补齐（非实时精确，可接受——数据本身轮次终态才落库）。
