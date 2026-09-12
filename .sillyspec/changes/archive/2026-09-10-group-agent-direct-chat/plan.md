---
plan_level: full
---

# 实现计划（Plan）— 2026-09-10-group-agent-direct-chat

## Spike 前置验证

无 Spike：全部机制照现有源码先例（行锁幂等/后台 sweeper/inject busy 降级/投影判定均已在生产路径验证），无新技术栈不确定性。

## Wave 1（并行，无依赖）

- task-01
- task-02
- task-04

## Wave 2（依赖 Wave 1）

- task-03
- task-05

## Wave 3（依赖 Wave 2）

- task-06
- task-07

## Wave 4（依赖 Wave 3）

- task-08

## Wave 5（依赖 Wave 3/4；09 与 10 无共享文件可并行）

- task-09
- task-10

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 数据模型与迁移（两列+新表+索引） | W1 | P0 | — | FR-1.1, D-008 | AgentGroupChat 列 + agent_group_consensus_tasks 表 + alembic |
| task-02 | schema 与设置链路 | W1 | P0 | — | FR-1.1, D-002 | Create/Update/Read + 触发响应 DTO 扩展 + 角色 prompt 常量（helpers.py，避免与 task-04 同 Wave 共享） |
| task-04 | 触发原语扩展（role_prompt/turn_overrides） | W1 | P0 | — | FR-1.3, D-007 | _trigger_group_member 参数化（仅 shadow.py），懒建/复用双分支写 metadata |
| task-03 | @解析 split_broadcast + 发送侧汇总分支 | W2 | P0 | task-01,02,04 | FR-1.2, D-003 | 汇总人选择三场景、建任务+状态卡（consensus.py 首版由本卡创建）、fan-out 标记、coordinator 失败 aborted |
| task-05 | 投影层硬拦截 | W2 | P0 | task-04 | FR-2.1, D-005, D-007 | ctx 扩展 + submit_steps 双写/兜底行统一拦截，converge 放行 |
| task-06 | 互@私聊改造 | W3 | P0 | task-04,05 | FR-2.1~2.4, D-005 | run_cross_mention_detection 触发加 dm 标记；护栏零改动；测试断言更新 |
| task-07 | 汇总状态机（consensus.py 扩展） | W3 | P0 | task-01,03 | FR-1.3~1.7, FR-3.1~3.3, D-004, D-008 | 登记/收口判定/注入（行锁幂等）+ 影子健康与群解散检查（在 task-03 首版上扩展） |
| task-08 | 收口钩子接线（意见聚合→转交→任务推进→converge 闭合） | W4 | P0 | task-05,07 | FR-1.3~1.5, D-007 | _close_group_hooks 扩展；全量 assistant 文本聚合（截 4000） |
| task-09 | sweeper 循环与 main.py 挂载 | W5 | P0 | task-07 | FR-1.4, FR-3.1, D-004 | 30s 扫超时强制收口；照 lease_expiry_sweeper 挂载先例 |
| task-10 | 前端与类型（gen:types/向导/设置/状态卡） | W5 | P0 | task-02（OpenAPI），行为对照 W4 定稿 | FR-1.6 | api-types 重生成 + 三组件 + 测试 |

## 关键路径

task-01 → task-03 → task-07 → task-08（数据模型 → 发送分支 → 状态机 → 收口接线，最深 4 波决定交付周期）

## 全局验收标准

1. 新增测试（test_group_consensus.py）与更新的既有互@测试全部通过；backend 相关子集 `uv run pytest -q --no-cov <相关测试文件>` 绿。
2. 集成冒烟（integration-critical 判级）：本地起栈后走查——建群开汇总模式 → 多 @ 消息 → 群内仅状态卡 → 成员意见不进群 → 收口总结一条进群 → 超时路径（调小 timeout）强制收口。
3. 零回归：开关关闭的群发送多 @ 消息行为与现状一致（既有群聊测试全绿）；单聊/worker 会话零进入。
4. `pnpm gen:types` 产物（api-types.ts + openapi.json）随变更提交；frontend lint/test 绿；daemon 零改动确认（git status 无 sillyhub-daemon 文件）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-002@v1 | task-01,02,03 | 开关默认关 + 关闭路径零变化对照断言（全局验收 3） |
| D-003@v1 | task-03 | 汇总人选择三场景单测 |
| D-004@v1 | task-07,09 | 收口判定矩阵单测 + 超时收口测试 |
| D-005@v1 | task-05,06 | 互@回复零投影断言 + 注入发起方断言 |
| D-006@v1 | task-07,10 | 状态卡落库/更新单测 + 前端渲染测试 |
| D-007@v1 | task-04,05,08 | 投影硬拦截（[[GROUP]] 也拦）单测 + 后端驱动链路 |
| D-008@v1 | task-01,07,09 | 任务表状态机 + sweeper 兜底单测 |
| FR-1.1~1.7 | task-01~03,07~09 | test_group_consensus.py 全套 |
| FR-2.1~2.4 | task-05,06 | test_group_cross_mention 更新 + 新增断言 |
| FR-3.1~3.3 | task-07,08,09 | 行锁幂等/崩溃恢复路径单测 |
| FR-4.1~4.2 | task-03,05 | 关闭对照断言 + kind 谓词精确断言 |
