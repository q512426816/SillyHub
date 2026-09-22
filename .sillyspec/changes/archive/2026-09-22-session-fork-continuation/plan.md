---
plan_level: full
---

# 实现计划（Plan）— 会话任意点分叉与谱系溯源

> 变更：2026-09-22-session-fork-continuation（brainstorm 已全绿收口；design.md 为唯一设计真相，本计划只编排不重述设计）

## Wave 1（并行，无依赖）
- task-01
- task-02

## Wave 2（依赖 Wave 1）
- task-03

## Wave 3（依赖 Wave 2）
- task-05

## Wave 4（依赖 Wave 3）
- task-06
- task-07

## Wave 5（依赖 Wave 4）
- task-04
- task-08

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 数据模型迁移 | W1 | P0 | — | FR-02, FR-07 | model.py fork 三列+origin='fork' 约束（不写 parent/tree_depth）+engine_anchor+索引；alembic 迁移；模型单测 |
| task-02 | 双 spike 定档 | W1 | P0 | — | D-004@v1, D-007@v1, R-01, R-02 | pi RPC fork/switch_session 截断语义实测；claude resumeSessionAt×forkSession 真机（含 resumeDropsTurn 守卫与错误浮出路径）；结论落 spike-pi-fork.md + D-008 |
| task-03 | caps 第 16 键 | W2 | P0 | task-02 | FR-06 | providers.ts sessionFork 枚举键（pi 值按 spike 定）+gen-provider-caps.mjs（dialog 枚举先例扩展）+三端镜像+alignment 升 16 键+缺键按 none 兜底 |
| task-04 | 轮锚点回填 | W5 | P1 | task-01, task-06 | FR-07 | 消费端实现（D-011：数据源=task-06 driver 补挂的消息级 metadata.engineAnchor）：submit_commit.py 轮终态取该轮已落库消息锚——claude=末条 assistant 链 UUID、pi=首条 user entryId，写 AgentRun.engine_anchor；无键不写不伪造；六类场景单测 |
| task-05 | backend fork 服务与契约 | W3 | P0 | task-01, task-03 | FR-01, FR-02, FR-03, FR-04 | fork.py（归属/终态/档位/锚点四重校验+native·seed 分派+build_seed_prompt 24K 帽+快照继承+fork 记录落库）+create.py 增 fork 参数组+service/__init__.py re-export+端点+DTO+SessionRead 透出+placement.py 写 metadata+daemon/lease/context.py:459 白名单透传两键+gen:types+pytest（含 A 零字段改动断言） |
| task-06 | daemon fork 透传 | W4 | P0 | task-05 | FR-03, FR-04 | daemon.ts execPayload 解析+CreateSessionInput 增 resumeAtUuid/forkSession+driverOpts 组装+claude-sdk-driver options（forkSession 独立转发分支，R-07 解耦 systemPrompt 守卫）+（pi spike 成才接）pi driver fork 启动路径+单测 |
| task-07 | 前端分叉发起 | W4 | P1 | task-05 | FR-01, FR-04 | sessions.ts forkSession 封装+手写镜像补齐+轮头「从此分叉」入口（caps≠none/终态轮/native 锚点缺失灰三重门控）+fork-confirm-modal 档位语义标注+组件测试 |
| task-08 | 谱系溯源 UI + E2E | W5 | P1 | task-06, task-07 | FR-02, FR-05 | lineage-block 溯源块+多跳面包屑+worker-session-overlay 标题参数化+「已分叉」状态条+列表 origin+fork_of 分组徽标+page/dialog 双挂载+组件测试+claude 真机 E2E（B 不知分叉点后内容）记录入变更目录 |

## 关键路径
task-01 → task-03 → task-05 → task-06 → task-04/task-08（D-011 后：task-04 依赖 task-06 的 metadata 补挂，与 task-08 同汇于 W5；task-02 spike 是 task-03 前置门，task-07 与 task-06 并行）

## 全局硬约束（从 design.md 抄录，绑定所有 task）
- fork 会话**不写 parent_session_id（恒 NULL）、tree_depth 恒 0**——谱系由 fork_of_session_id 单向链表达，分身树语义不混用；列表分叉组按 origin+fork_of 判定，分身组仍按 parent_session_id 判定。
- **无新 WS 协议消息**：fork 参数沿既有 lease 认领链（placement 写 metadata → build_claim_payload 白名单 → execPayload → CreateSessionInput → driverOpts）。
- native 档下行两键 `resume_at_uuid`/`fork_session` 必须经 backend/app/modules/daemon/lease/context.py:459 白名单——漏此环节静默断链（Grill B-1）。
- 种子帽 FORK_SEED_MAX_CHARS=24000，超限截尾+声明；用户轮全文优先、助手轮摘要。
- engine_anchor 仅 claude 档回填；存量轮不回填（入口置灰即可，不重建锚点）。
- api-types.ts 必须由 `pnpm gen:types` 生成禁止手写；openapi.json+api-types.ts 随变更提交。
- 双主题铁律：新 UI 用 brand-* 语义阶与主题 token（themes.ts 单一源），不硬编码 hex；浮层复用 WorkerSessionOverlay 形态（AI-Native 风格对齐原型 prototype-session-fork.html）。
- 禁止跑全量测试，仅跑 scoped（本变更各卡自带测试文件）；全量留给 CI。
- SillySpec CLI 一律在主仓根目录跑；提交声明必须 `git show <hash> --stat` 复核。
- 非目标边界：不做 handoff 自动续接/原会话冻结/轮内分叉/分支画布/不改既有 resume·reopen·inject 语义。

## 全局验收标准
1. 各卡 scoped 单测全绿（backend test_session_fork.py+test_engine_anchor.py、daemon session-fork.test.ts+alignment 16 键、前端两组组件测试）；tsc/ruff/mypy 定向零错。
2. claude 真机 E2E：第 N 轮分叉后 B 能答第 1~N 轮上下文问题、对第 N+1 轮及之后内容不知情；fork 后 A 全部字段零变化。
3. codex（及 pi 若 seed 档）分叉为转述种子启动，体积受帽；cursor 无入口且 API 422。
4. 未分叉用户既有行为与 API 响应零变化（新列可空、端点独立、caps 缺键视为 none）。
5. verify 阶段对照 requirements.md FR-01~07 逐条核验并写 verify-result.md。

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-05, task-07 | 任意会话可分叉（无 sillyspec 依赖）端点+入口 |
| D-002@v1 | task-08 | 溯源块+浮层+面包屑组件测试 |
| D-003@v1 | task-01, task-05 | 轮级粒度（AgentRun 锚）模型与校验 |
| D-004@v1 | task-02, task-03, task-05, task-07 | 两档定档+分派+UI 档位标注 |
| D-005@v1 | task-05 | A 零字段改动 pytest 断言 |
| D-006@v1 | —（范围约束） | 全计划无 sillyspec 仓任务 |
| D-007@v1 | task-05, task-06 | backend 主导管道透传（无新协议） |
| FR-01 | task-05, task-07 | 端点四重校验+入口三重门控测试 |
| FR-02 | task-01, task-05, task-08 | fork 记录三件套+快照继承+E2E |
| FR-03 | task-05, task-06 | native 参数全链透传+E2E 不知情断言 |
| FR-04 | task-02, task-03, task-05, task-07 | spike 定档+种子帽+档位标注 |
| FR-05 | task-08 | 谱系组件测试+多跳链 |
| FR-06 | task-03 | alignment 16 键+缺键兜底 |
| FR-07 | task-01, task-04 | engine_anchor 列+回填单测 |
