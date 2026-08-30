---
author: qinyi
created_at: 2026-08-29 13:22:15
---
# 提案书（Proposal）

## 动机

用量统计细化到供应商×模型（change 2026-08-29-usage-by-provider-model）后，运行时维度已有用量视图（`GET /runtimes/usage` + 运行时页用量卡），但**会话维度没有**：用户在一个会话里连续对话，看不到该会话累计的输入/输出/缓存 token、模型调用次数与缓存命中率。数据面已齐备（`agent_run_model_usage` 明细表 + `AgentRun` 四维 token 列），只缺会话级聚合出口与前端展示。

## 关键问题

1. **无会话级聚合端点**：`AgentSessionRead` 不含用量字段，`SessionRunRead` 仅输入/输出两维（无缓存四维与请求次数）——前端无法拼出完整数字。
2. **历史轮次口径断层**：按模型明细表是 2026-08-29 起落库，之前的轮次只有 `AgentRun` 四维列——纯明细聚合会漏掉老会话/老轮次的用量。
3. **双模式展示约束**：会话面板 dialog 渲染路径为零 react-query 约定，数据获取组件形态需避开 QueryClientProvider 依赖。

## 变更范围

- **backend**：`GET /api/daemon/sessions/{session_id}/usage` 聚合端点（明细表 GROUP BY model 为主 + 无明细 run 四维列兜底，owner-only 404），`SessionUsageRead`/`SessionUsageModelItemRead` DTO。
- **frontend**：`session-usage-bar` 组件（摘要行五指标+命中率、按模型折叠明细；自取数 useEffect + `refreshSignal` prop），page/dialog 双模式渲染点接线，轮次终态递增信号。
- **配套**：gen:types 同步 `api-types.ts` + `backend/openapi.json`。

## 不在范围内（显式清单）

- 不做金额/计费折算（Non-goals，见 design.md）
- 不做跨会话/工作区级汇总（运行时页已覆盖）
- 不做实时逐 token 更新（数据粒度=轮次终态）
- 不改 daemon 侧代码、零迁移、零状态机变化（纯只读聚合）
