---
author: qinyi
created_at: 2026-08-29 15:12:45
plan_level: full
---
# 实现计划（Plan）— 审批流站内通知推送

> 来源：design.md（Grill 修订版，risk_level=integration-critical）/ requirements.md FR-01~FR-09 / decisions.md（11 条当前版本，无 unresolved）。
> 任务名唯一真相在 tasks.md；本文件 Wave 段为纯 ID 引用。

## Spike 前置验证

无 Spike：全部技术要素（SQLModel 建模+Alembic、Redis Pub/Sub best-effort publish、SSE 生成器、React Query+fetch-sse）在仓库内均有成熟先例（design §1.2 逐条列出），纯业务逻辑组装，无未经验证的集成。

## Wave 1（并行，无依赖——地基）

- task-01
- task-03

## Wave 2（依赖 W1——通知核心）

- task-02

## Wave 3（依赖 W2，四路并行——触发点与 REST）

- task-04
- task-05
- task-06
- task-07

## Wave 4（依赖 W3——SSE 端点与后端收口；08 与 07 共享 router.py/test_router.py 故必须异 Wave 串行）

- task-08
- task-12

## Wave 5（依赖 W4——类型同步）

- task-09

## Wave 6（依赖 W5——前端数据层）

- task-10

## Wave 7（依赖 W6——铃铛组件）

- task-11

## Wave 8（依赖 W7——前端收口）

- task-13

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | notifications 表模型 + Alembic 迁移 | W1 | P0 | — | FR-01, D-004@v1 | model.py + 迁移（down_revision 接唯一 head）+ **migrations/env.py 模型登记**（漏登记=不生成表，Grill X-16）；测试随任务内写（建表/回退） |
| task-02 | NotificationService + 通道抽象 | W2 | P0 | task-01,03 | FR-02, D-003@v2, D-006@v1, D-009@v2 | service.py（广播/定向/幂等/消解/独立事务）+ NotificationChannel Protocol + InAppChannel + events.py publish 助手（镜像 session_events.py） |
| task-03 | rbac 广播收件人反查 | W1 | P0 | — | FR-03, D-002@v1 | list_user_ids_with_permission（镜像 has_permission 三段 + 活跃账户过滤），auth 模块测试 |
| task-04 | 触发点① platform_sync 待办钩子 | W3 | P0 | task-02 | FR-04, D-011@v1, D-009@v2, D-001@v1 | upsert_progress 尾部旁路：in-hand latest_progress 判定（复用 _project_current_stage 提取+_map，禁用 compute_pending_review）；try/except best-effort；幂等由 service 统一 |
| task-05 | 触发点② change 审批结果+消解 | W3 | P0 | task-02 | FR-05, D-007@v1 | 四门+approve/reject 末尾：resolve_pending + notify_user(owner)（owner None 跳过）；文案常量集中 |
| task-06 | 触发点③ daemon 权限通知 | W3 | P0 | task-02 | FR-06, D-008@v1, D-010@v1, D-001@v1 | handle_permission_request/_on_timeout 挂钩；owner=AgentSession.user_id（_on_timeout 重查）；自响应豁免 |
| task-07 | REST 四端点 + DTO + 路由注册 | W3 | P0 | task-02 | FR-08 | 列表/未读数/单条已读(404 越权)/全部已读 + NotificationRead 等 DTO + main.py include_router；中文文案 |
| task-08 | SSE 端点 /api/notifications/events | W4 | P0 | task-02 | FR-07, D-003@v2 | 照抄 sessions/events 模式：短 session 鉴权、服务端按 recipient 过滤、keepalive、finally 清理、无 Last-Event-ID |
| task-09 | gen:types 类型同步 | W5 | P0 | task-07,08 | FR-09 | `pnpm gen:types`（先确认 node_modules 健康，CLAUDE.md 规则 21），提交 openapi.json + api-types.ts |
| task-10 | 前端数据层 | W6 | P0 | task-09 | FR-09, D-005@v1 | lib/notifications.ts（fetch+hooks+SSE 订阅 hook：事件→invalidate、重连补拉、退避+永久错误停连）+ query-keys 工厂；**无 refetchInterval** |
| task-11 | 铃铛组件 + 挂载 | W7 | P0 | task-10 | FR-09, D-005@v1 | notification-bell.tsx（徽标/面板/已读/跳转/空态，对照原型）+ top-bar.tsx 挂载；三主题 brand-* 语义阶 |
| task-12 | 后端整合回归 + local.yaml 映射 | W4 | P0 | task-04,05,06 | FR-01~08 | notification 模块测试套件收口 + 三触发点回归 + **local.yaml modules 块补 notification 映射**（不补则 verify 对账 fallback backend 全量被预存 errors 阻塞）+ ruff/mypy 0 错 |
| task-13 | 前端测试 + tsc 收口 | W8 | P1 | task-10,11 | FR-09 | notification-bell 用例（含 SSE 事件驱动刷新）+ tsc 零错 |

## 关键路径

task-01 → task-02 → task-07/08 → task-09 → task-10 → task-11 → task-13（表→服务→端点→类型→前端数据层→组件→测试，决定最短交付周期；触发点 04/05/06 与 07/08 并行不占关键路径）

## 全局验收标准

1. 后端相关模块测试绿：`uv run pytest app/modules/notification -q --no-cov -n auto` + change/daemon/platform_sync/auth 回归（只跑相关，禁全量，CLAUDE.md 规则 0）。
2. 前端：notification-bell 组件用例绿 + `tsc` 零错；`pnpm gen:types` 产物（openapi.json + api-types.ts）已提交。
3. **integration-critical 集成冒烟（design frontmatter 声明，verify 强制证据门）**：真实 Redis 下端到端——触发审批事件 → notifications 落库 → SSE `/api/notifications/events` 收到该用户 `notification` 事件；跨用户不下发（隔离断言）；Redis 停用时不阻塞审批主流程（降级断言）。
4. 幂等/消解行为验收：重复推送进度不重复通知；驳回重跑待办再现再通知；审批动作后 owner 收到结果且旧待办置已读（对应 FR-04/FR-05 GWT）。
5. brownfield 兼容：未触发审批事件时现有 API/页面行为不变；存量待办不回溯补发。
6. `ruff check` / `ruff format --check` / `mypy app` 0 错；通知文案全中文。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（范围） | task-04, task-06 | FR-04/FR-06 用例；release 模块零改动 |
| D-002@v1（接收人） | task-03 | FR-03 三段语义反查用例 |
| D-003@v2（方案A架构） | task-02, task-08 | FR-02/FR-07；无事件总线类 |
| D-004@v1（展开行落库） | task-01 | FR-01 建表/回退用例 |
| D-005@v1（铃铛+无轮询） | task-10, task-11 | FR-09；代码内无 refetchInterval 断言 |
| D-006@v1（best-effort） | task-02, task-04 | FR-02 异常降级用例（Redis 停用不阻塞） |
| D-007@v1（消解+结果通知） | task-05 | FR-05 GWT 用例 |
| D-008@v1（自响应豁免） | task-06 | FR-06 respond 无通知断言 |
| D-009@v2（幂等收口） | task-02, task-04 | FR-04 幂等/再通知两用例 |
| D-010@v1（owner=AgentSession.user_id） | task-06 | FR-06 收件人=会话创建者断言 |
| D-011@v1（in-hand 判定） | task-04 | FR-04 用例（以推送 body 为准） |
| FR-01 | task-01, task-12 | AC-1 |
| FR-02 | task-02, task-12 | AC-1/AC-3 |
| FR-03 | task-03 | AC-1 |
| FR-04 | task-04, task-12 | AC-4 |
| FR-05 | task-05, task-12 | AC-4 |
| FR-06 | task-06, task-12 | AC-3/AC-4 |
| FR-07 | task-08, task-12 | AC-3 |
| FR-08 | task-07, task-12 | AC-1 |
| FR-09 | task-09, task-10, task-11, task-13 | AC-2 |
