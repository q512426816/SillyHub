---
author: qinyi
created_at: 2026-07-29T10:28:42
plan_level: full
---

# 实现计划（Plan）— 模型调用失败可见性完整修复（claude code 会话）

## Spike 前置验证

本变更方案 C（三端标准协议）经 brainstorm Design Grill 独立审查通过（specVerdict/qualityVerdict = pass/pass）。核心技术点（stream-json is_error/resultText 提取于 stream-json.ts:902-904、api_retry.error 于 :866、AgentRun JSON 列 + alembic migration、classifier 关键词归类、pnpm gen:types 同步）均有源码核实与成熟实现路径，**无技术不确定性，跳过 Spike**。

## Wave 1（并行，无依赖 — 契约基础 + 独立 schema/配置）

- [x] task-01: 定义三端同构 ModelError 协议 + 类型枚举（daemon `model-error/types.ts` + backend `model_error.py` ModelErrorDTO；覆盖：FR-01, D-001, D-003, D-005, D-006）
- [x] task-05: backend AgentRun 加 `error_detail`（JSON 列）+ alembic migration（全局 `backend/migrations/versions/`，down 接当前真实 head；覆盖：FR-02, D-007, D-009）
- [x] task-12: local.yaml modules 块加 backend daemon + agent 子模块 test 条目（防 verify fallback backend 全量预存 errors；覆盖：非功能-可测试）

## Wave 2（依赖 Wave 1）

- [x] task-02: daemon `model-error/classifier.ts` 实现（claude 错误归类：is_error / resultText / api_retry / assistant stdout → ModelError）+ 单测覆盖 8 类（覆盖：FR-01, D-003, D-006）
- [x] task-06: backend InteractiveRunResultRequest 加 `error` + close_interactive_run（run_sync/service.py:735 实体 + service.py:508 facade + router.py:1118 路由）接收写入 AgentRun.error_detail（覆盖：FR-02, D-009）

## Wave 3（依赖 Wave 2）

- [x] task-03: daemon stream-json adapter 接入 classifier（result is_error=true 时产出 ModelError，stream-json.ts:902+）（覆盖：FR-01）
- [x] task-07: backend 新增 `GET /sessions/{id}/runs` 返回 error_detail + SSE（router.py:1880）推 error 事件 + `pnpm gen:types` 同步 OpenAPI（覆盖：FR-02）

## Wave 4（依赖 Wave 3）

- [x] task-04: daemon notifyRunResult payload 增 `error` 字段（hub-client.ts:530+）+ daemon.ts payload 映射（:1354-1397）+ session-manager turn 收尾携带 error（覆盖：FR-01/02 链路贯通）
- [x] task-08: frontend `pnpm gen:types` + normalize.ts 识别 error_detail 生成 error 类日志项（修正 :352 把 `[ASSISTANT] API Error` 误判 assistant）（覆盖：FR-03, FR-04）

## Wave 5（依赖 Wave 4）

- [x] task-09: frontend RunErrorItem 组件（type → 图标/颜色/文案/hint/actions）+ 单测（覆盖：FR-03, D-002, D-004）

## Wave 6（依赖 Wave 5）

- [x] task-10: frontend 会话页（agent/runtime 页）集成 RunErrorItem + run failed 状态标红 + actions（重发 inject / 切换供应商 / 查看详情 raw）（覆盖：FR-03, D-002, D-004）

## Wave 7（依赖全部）

- [x] task-11: 回归测试（agent-log-display-fix NOISE 折叠不误吞 error_detail 错误项 + 成功路径 is_error=false 不回归）+ e2e 复现（模型失败 → 看到错误项 + actions）（覆盖：FR-04, D-008）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 三端 ModelError 协议 + 枚举 | W1 | P0 | — | FR-01, D-001/003/005/006 | 契约核心，daemon types + backend DTO |
| task-02 | daemon classifier + 8 类单测 | W2 | P0 | task-01 | FR-01, D-003/006 | 关键词/正则归类，含 429 quota/rate 区分 |
| task-03 | stream-json 接入 classifier | W3 | P0 | task-02 | FR-01 | result is_error 时产出 ModelError |
| task-04 | notifyRunResult + daemon.ts + session-manager | W4 | P0 | task-03 | FR-01/02 | payload 带 error，daemon 链路贯通 |
| task-05 | AgentRun error_detail 列 + migration | W1 | P0 | — | FR-02, D-007/009 | JSON 单列，与 error_code 正交 |
| task-06 | InteractiveRunResultRequest + close_interactive_run | W2 | P0 | task-01, task-05 | FR-02, D-009 | facade + 实体 + router 透传写入 |
| task-07 | GET /sessions/{id}/runs + SSE + gen:types | W3 | P0 | task-06 | FR-02 | 新端点 + SSE error 事件 |
| task-08 | frontend gen:types + normalize | W4 | P0 | task-07 | FR-03/04 | error_detail → error 类日志项 |
| task-09 | RunErrorItem 组件 + 单测 | W5 | P0 | task-08 | FR-03, D-002/004 | type → 图标/文案/hint/actions |
| task-10 | 会话页集成 | W6 | P0 | task-08, task-09 | FR-03, D-002/004 | 集成 + failed 标红 + actions |
| task-11 | 回归 + e2e | W7 | P0 | task-04, task-10 | FR-04, D-008 | NOISE 不误吞 + 成功不回归 + e2e |
| task-12 | local.yaml modules daemon/agent 条目 | W1 | P1 | — | 非功能-可测试 | 防 verify fallback backend 全量 |

## 关键路径

task-01 → task-06 → task-07 → task-08 → task-09 → task-10 → task-11（前端 + backend 链路 7 层，决定最短交付周期）。daemon 链路 task-01 → task-02 → task-03 → task-04 → task-11 为 5 层，可与前端链路并行推进，二者在 Wave 7（task-11）汇合。

## 全局验收标准

- [x] daemon classifier 单测 8 类全过（auth_failed / quota_exceeded / rate_limited / timeout / model_not_found / network / provider_error / unknown）
- [x] backend：AgentRun.error_detail migration 成功（alembic upgrade head 无多 head）；close_interactive_run 写入 error_detail；GET /sessions/{id}/runs 返回 error_detail；SSE 推 error 事件
- [x] frontend：pnpm gen:types 同步（api-types.ts + backend/openapi.json）；normalize 将 error_detail → error 类日志项；RunErrorItem 渲染 + actions 可用；run/session failed 标红
- [x] 回归：agent-log-display-fix 的 NOISE 折叠不误吞 error_detail 错误项；成功路径（is_error=false）无 ModelError、error_detail=None
- [x] e2e 复现：模型调用失败时（执行期若 GLM 额度已重置恢复，改用无效凭证注入触发 auth_failed 或 mock 429 验证 classifier 各 type）会话页显示错误项 + 原因 + hint + actions
- [x] 三端 ModelError 契约一致（pnpm gen:types 保证，非手写）
- [x] 不影响 PPM 模块（已上线）
- [x] （brownfield）未配置 / 无错误时行为不变（error 字段可选，缺失兜底，不崩溃）

## 覆盖矩阵（decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（claude 优先） | task-01, task-02 | 协议 + classifier 按 agent 分发（仅 claude 落地） |
| D-002@v1（展示错误项 + 状态失败） | task-09, task-10 | RunErrorItem 渲染 + 会话页集成 failed 标红 |
| D-003@v1（细分类型 + 针对性提示） | task-01, task-02 | ModelErrorType 枚举 + classifier 归类规则 |
| D-004@v1（重发 / 切换 / 详情 actions） | task-09, task-10 | RunErrorItem actions 按钮 |
| D-005@v1（方案 C 三端协议） | task-01 | 三端同构 ModelError 贯穿 |
| D-006@v1（429 quota vs rate） | task-01, task-02 | 两个独立 type + classifier 文本区分 |
| D-007@v1（JSON 列 error_detail） | task-05 | AgentRun 单列 JSON |
| D-008@v1（Non-Goals 边界） | task-11 | 回归验证不改 GLM token / 不回填 / 不自动恢复 |
| D-009@v1（error_code vs detail 分工） | task-05, task-06 | 正交不互相覆盖 |
