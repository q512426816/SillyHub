---
author: qinyi
created_at: 2026-08-25 22:52:10
change: 2026-08-25-session-spec-binding
plan_level: full
---

# 实现计划（Plan）：会话与变更/快速修复多对多绑定

## 来源
brainstorm 四件套（design.md §5 W1-W5 / §6 文件清单 / §8 数据模型 / decisions.md D-001~D-006）。任务从 brainstorm 骨架 20 条收敛为 13 条（模型+迁移合一、各层测试并入实现卡、lib/daemon.ts 客户端层独立成卡避免前端并行冲突）。

## 范围
- backend：change（binding/模型/端点）、agent（tool_kind 重构）、daemon（run_sync 接线、sessions 列表筛选与创建落绑定）、platform_sync（agent-logs 双分支绑定）、alembic 迁移、openapi
- frontend：sessions 门户/列表（QuicklogScope+筛选）、session-panel/floating（quickId）、quicklog 抽屉会话卡、lib/daemon.ts
- 不动：sillyhub-daemon/**（design §6 显式）

## Wave 1（数据层地基）
- task-01

## Wave 2（绑定基座与读取改造，依赖 Wave 1，三卡并行无共享文件）
- task-02
- task-03
- task-04

## Wave 3（检测接线与新端点，依赖 Wave 2，四卡并行无共享文件）
- task-05
- task-06
- task-07
- task-08

## Wave 4（前后端契约分界：类型再生成 + 客户端层，依赖 Wave 3 全部 schema 变更）
- task-09

## Wave 5（前端三卡并行，依赖 Wave 4；task-10/11/12 文件互不重叠。task-12 与 task-10 的门户路由集成由 task-13 走查覆盖）
- task-10
- task-11
- task-12

## Wave 6（回归与验收，依赖全部）
- task-13

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | QuicklogSessionLink 模型 + alembic 迁移（建表+存量播种） | W1 | P0 | — | FR-02, D-001, D-002 | change/model.py 新模型 + 20260825223000 迁移；迁移测试（播种幂等/ON CONFLICT） |
| task-02 | change/binding.py 绑定基座 + tool_kind 分段提取 | W2 | P0 | task-01 | FR-01, D-003, D-004, D-005@v2 | iter_command_segments 提取（行为不变+单测锁）/ extract_spec_bindings 规则 / bind 两函数（default 守卫+placeholder+savepoint best-effort）；解析样例库+幂等单测 |
| task-03 | list_change_sessions 改读 links + 标题共享 helper | W2 | P0 | task-01 | FR-03, D-002 | change/router.py 查询换 M:N；window-function 标题提取提共享 helper（X-013）；links 读取/软删过滤测试 |
| task-04 | daemon sessions 列表筛选升级（change_id→M:N + 新增 ql_id） | W2 | P0 | task-01 | FR-05, D-002 | daemon/router.py 查询参数 + session/service.py 子查询 + schema；命中集测试（含播种行） |
| task-05 | run_sync 消息入库命令解析接线 | W3 | P0 | task-02 | FR-01, D-003, D-004, D-005@v2 | submit_messages 循环 sillyspec tool_call→提取→绑定；agent_session_id NULL 守卫（X-002）；集成测试 + 既有 run_sync 测试断言更新（related_tests：daemon/tests/test_run_sync_*.py 命中文件） |
| task-06 | platform_sync agent-logs 双分支绑定接线 | W3 | P0 | task-02 | FR-01, FR-02, D-003 | hub 分支补消费 ctx（互斥并存 quick 优先）+ 聚合分支 tool_report 落绑定；两分支测试（含 default 不建 placeholder）+ 既有 test_agent_log_push.py 断言更新 |
| task-07 | 新端点 GET quicklog-entries/{ql_id}/sessions | W3 | P0 | task-03 | FR-04 | 复用共享 helper + AgentSessionListItem；绑定命中/空态/软删/跨成员测试 |
| task-08 | 创建会话落绑定 + SessionCreateRequest.quicklog_id | W3 | P0 | task-02 | FR-04, FR-06, D-002 | daemon/schema+router+session/service（change_id 双写 link、quicklog_id 新写）；创建测试 + 既有会话创建测试断言更新（gen:types 移至 task-09，审 7-g2） |
| task-09 | gen:types + lib/daemon.ts API 客户端扩展 | W4 | P0 | task-04, task-07, task-08 | FR-04, FR-05, FR-06 | 先跑 pnpm gen:types（api-types.ts+openapi.json，覆盖 W3 全部 schema 变更含 task-07 端点）再写 listAgentSessions ql_id / createSession quicklog_id / listQuicklogSessions；lib/daemon.test.ts 客户端测试更新 |
| task-10 | QuicklogScope 门户 + 路由页 + 关联筛选下拉 | W5 | P0 | task-04, task-09 | FR-04, FR-05 | session-list-panel（类型+六消费点【X-008】+筛选下拉【门控 scope?.kind==="workspace"，X-009】）+ sessions-portal quicklog 分支 + 新路由薄壳；组件测试 + 既有 SessionListScope 类型相关测试更新 |
| task-11 | preContext quickId（session-panel + floating） | W5 | P0 | task-09 | FR-06 | SessionPreContext/FloatingPreContext.quickId + handlePreSessionSend quicklog_id + 标题解析 query；请求体断言测试（落点 session-panel 既有 pre-session 测试文件） |
| task-12 | quicklog 抽屉关联会话卡 | W5 | P1 | task-07, task-09 | FR-04 | quicklog-sessions-card（预览3条/深链/工作台入口/空态）+ drawer 挂载；渲染测试 + 既有 quicklog-drawer.test.tsx 挂载断言更新（与 task-10 门户路由的运行时集成由 task-13 走查覆盖） |
| task-13 | 全量回归 + 环境走查验收 | W6 | P0 | task-01..12 | 全部 FR + NFR | backend pytest + frontend vitest + tsc + gen:types check；真实会话跑 sillyspec run --change / run quick 走查（R-01 验证）；对照 requirements.md 逐条验收 |

## 关键路径
task-01 → task-02 → task-08 → task-09 → task-10 → task-13（数据层→绑定基座→创建落绑定+类型→门户/筛选→回归，最短交付链）

## 全局验收标准
1. backend 全量 pytest 绿（含 change/agent/daemon/platform_sync 新旧用例）；frontend vitest + tsc 绿；gen:types check 零漂移。
2. FR-01/02 环境走查：平台会话内分别执行 `sillyspec run <阶段> --change <变更>` 与 `sillyspec run quick`，变更/快速修复侧出现该会话；多对多（一会话多变更）成立。
3. FR-03/04/05/06 按 requirements.md 各自验收条目逐项核验（结果落 verify-result.md）。
4. brownfield 兼容：未跑过 sillyspec 的会话列表/详情行为不变；迁移后存量单 FK 关联在变更会话卡仍可见。
5. daemon（Node）侧零改动验证：git diff 不含 sillyhub-daemon/。

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-07 | 自然键表结构+迁移测试；无 FK 条目行先绑用例 |
| D-002@v1 | task-01, task-03, task-04, task-08 | 播种 SQL+幂等；links 读取；M:N 筛选；创建双写 |
| D-003@v1 | task-02, task-05, task-06 | 解析函数+两通道接线测试 |
| D-004@v1 | task-02, task-05, task-06 | quick 子命令不绑用例（命令解析+agent-logs 双侧） |
| D-005@v2 | task-02, task-05, task-06 | bind 函数 default 守卫单测+两通道 default 用例 |
| D-006@v1 | task-10, task-12 | QuicklogScope 路由+抽屉卡测试 |
| FR-01 | task-02, task-05, task-06 | 命令解析/hub/聚合三写入口测试+走查 |
| FR-02 | task-01, task-06 | quicklog links 建行+hub ctx 消费测试 |
| FR-03 | task-03 | list_change_sessions links 读取测试 |
| FR-04 | task-07, task-09, task-10, task-12 | 端点+客户端+门户+卡片测试 |
| FR-05 | task-04, task-09, task-10 | 筛选参数/透传/下拉测试 |
| FR-06 | task-08, task-09, task-11 | quicklog_id 创建落绑定+preContext 测试 |
