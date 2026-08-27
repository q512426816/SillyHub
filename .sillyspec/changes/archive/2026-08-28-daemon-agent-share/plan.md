---
author: qinyi
created_at: 2026-08-28 01:14:48
plan_level: full
---

# 实现计划（Plan）— 守护进程共享与平台共享智能体

> 任务名唯一真相在 tasks.md；本文件 Wave 段为纯 ID 引用。任务明细蓝图在
> `tasks/task-NN.md`。依据：design.md（4 Phase）+ decisions.md（D-001~D-010）。

## Spike 前置验证

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 | R-08 Bash 写逃逸（**plan 期已实证完成，D-009 定案**）：Write/Edit/MultiEdit 走 PolicyEngine realpath fail-closed 强制；Bash 写目标正则提取尽力而为、解释器类命令可逃逸 | 已定案消解：平台共享会话 `allowed_tools` 不含 Bash（gate 直接拒绝），产出走 Write/Edit——无 execute 期后果 |
| spike-02 | R-09 overlay 收紧的 policy_update 作用域（D-010）：per-runtime PolicyCache 是否会被共享会话的 writable_dir 收紧波及（误伤管理员同 runtime 普通会话）——**作为 task-05 首个验证项随实现进行** | 若为 runtime-wide：task-05 写约束改走 session 级 `_allowedRootsProvider`/claim 下推通道，其余 task 不受影响 |

## Wave 1（并行，无依赖）

- task-01

## Wave 2（依赖 Wave 1）

- task-02
- task-04

## Wave 3（依赖 Wave 2）

- task-03
- task-06
- task-07

## Wave 4（依赖 Wave 3）

- task-05

## Wave 5（依赖 Wave 4）

- task-08

## Wave 6（依赖 Wave 5）

- task-09
- task-10

## Wave 7（依赖 Wave 6）

- task-13
- task-12

## Wave 8（依赖 Wave 7）

- task-11

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | grants 数据层（模型+迁移+审计加列+存量迁移） | W1 | P0 | — | FR-01/04, D-006/D-008 | DaemonRuntimeGrant 表 + NULLS NOT DISTINCT + daemon_borrow_audit.grant_id + shared=true 迁移（跳过 daemon_id NULL） |
| task-02 | grants 授权查询（三查询+鉴权矩阵单测） | W2 | P0 | task-01 | FR-01/02, D-006 | authorize_pinned_runtime / list_machines_shared_to_me / resolve_granted_daemon_for_borrow |
| task-03 | 会话钉定校验切换 + 交互式借用审计 | W3 | P0 | task-02 | FR-02/03, D-001/D-006 | session/service.py:932-937 owner-only 扩授权 + placement 复查分支 + 审计含 grant_id；修改类端点零变化回归 |
| task-04 | 平台共享智能体 API | W2 | P0 | task-01 | FR-04, D-002@v2/D-003/D-008 | shared-agents CRUD（runtime 限自己名下在线/visibility 显式升级/writable_dir ⊆ allowed_roots）+ active 端点（grants/router.py 定义，挂载归 task-07） |
| task-05 | create_session platform 档案分支 | W4 | P0 | task-03, task-04 | FR-04, D-002@v2/D-007/D-009/D-010 | 检测前置二选一校验前 + 强制 pinned/cwd/overlay + allowed_tools 无 Bash；spike-02 作用域实证在此 |
| task-06 | 借用回退切 grants + 开关双写 | W3 | P0 | task-02 | FR-01, D-006 | borrow_resolver 切 grants 查询（语义等价）+ member_runtimes 开关端点同事务双写 + queries 薄壳 |
| task-07 | shared_to_me 装配 + grants router 挂载 | W3 | P0 | task-02, task-04 | FR-01, D-006 | machines/runtimes-page 附加共享区块（含 daemon/schema.py 响应模型 shared_to_me 字段）+ daemon/router.py include grants router |
| task-08 | gen:types 再生成 | W5 | P0 | task-03, task-04, task-05, task-06, task-07 | FR-01/04/05 | backend/openapi.json + frontend/src/lib/api-types.ts 同步提交（CLAUDE.md 规则 21） |
| task-09 | 前端守护进程页面（共享区块+管理卡+统计+API 封装） | W6 | P0 | task-08 | FR-01/04 | page.tsx 挂载两区块+统计计数；shared-machines-section + platform-shared-agents-card 两新组件 + lib/daemon.ts 封装 + 组件测试 |
| task-10 | 前端会话选择器共享标识 + 「平台共享」徽标 | W6 | P1 | task-08 | FR-05, D-004@v2 | 机器选择器共享徽标三入口（floating-host + 门户 session-config-bar.tsx + use-daemon-machines.ts 数据源）+ session-panel 徽标；悬浮助手回退链零改动 |
| task-11 | 回归确认（集成冒烟 + 手工验收） | W7 | P0 | task-09, task-10 | 全部 FR | R-02 interactive 沙箱 marker 回归、R-09 残余、写约束冒烟（目录内可写/外拒绝/Bash 拒绝）、页面/选择器手工验收 |

## 关键路径

task-01 → task-02 → task-03 → task-05 → task-12 → task-08 → task-09 → task-11（task-12 在 W7 落地但 08 仅消费 OpenAPI 不依赖 daemon 侧；08 于 W5 先行，12 不阻塞前端——关键交付路径不变）
（数据层 → 授权查询 → 会话钉定 → platform 分支 → 类型生成 → 守护进程页 → 回归）

## 全局验收标准

1. backend 命中模块测试全绿（local.yaml：daemon / agent / workspace 子集命令），前端相关组件测试全绿。
2. 兼容红线：未共享/未配置共享智能体时全部现有行为不变——agent-run 借用存量测试全量通过；修改类端点 owner-only 语义不变（FR-03 专项回归）。
3. 生命周期契约表（design §7.5）7 个事件逐项有实现落点与测试覆盖。
4. 集成冒烟（task-11）：workspace 共享会话创建→审计落库；platform 共享会话→写约束生效（writable_dir 内可写/外拒绝/Bash 在 gate 拒绝）。
5. 前端手工验收对照原型 prototype-daemon-agent-share.html（共享区块/管理卡/徽标）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-03, task-06, task-07 | FR-02/03 GWT 单测 + 修改端点回归 |
| D-002@v2 | task-04, task-05 | 写约束单测（目录内可写/外拒绝） |
| D-003@v1 | task-04 | 创建校验单测（非自己名下 runtime 拒绝） |
| D-004@v2 | task-10 | 选择器共享徽标渲染测试（回退链不变断言） |
| D-005@v1 | 全部 | 单变更 7 Wave 交付（组织决策） |
| D-006@v1 | task-01~task-07 | grants 全链路单测 |
| D-007@v1 | task-05 | 检测前置单测（只传共享档案/参数被覆写/不写借用审计） |
| D-008@v1 | task-01 | 迁移单测（NULLS NOT DISTINCT/跳过 daemon_id NULL 行） |
| D-009@v1 | task-05 | allowed_tools 断言（不含 Bash/NotebookEdit） |
| D-010@v1 | task-05 | 作用域单测（管理员同 runtime 普通会话写不受限） |
| D-011@v1 | task-12 | daemon 交集收紧单测 + backend 注入断言 |
