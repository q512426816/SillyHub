---
author: qinyi
created_at: 2026-08-23 14:05:00
plan_level: full
---

# 实现计划（Plan）— 工具上报 Agent 日志会话化

## Spike 前置验证
无——机制全部经 Design Grill 源码锚定（懒激活插桩点、prepare 独立调用、env 双注入源、pending 可见性、迁移链），初审-修订-复核闭环 passed。

## Wave 1（并行，无依赖）
- task-01
- task-02
- task-03

## Wave 2（依赖 W1）
- task-04

## Wave 3（依赖 W2）
- task-05

## Wave 4（依赖 W3）
- task-06

## Wave 5（依赖 W4）
- task-07

## Wave 6（依赖 W5 + 跨仓 W1）
- task-08

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 仓 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|---|
| task-01 | CLI 协议上下文上报 | W1 | P0 | — | sillyspec | FR-01, D-009 | 上报块后移 + entry 级 ctx 持久化 + hub_session_id(env) + 协议文档 + 测试 |
| task-02 | daemon env 注入 | W1 | P0 | — | main(daemon 目录) | FR-02 | buildSpawnEnv 三路径注入 SILLYHUB_SESSION_ID + 测试 |
| task-03 | 后端数据层 | W1 | P0 | — | main | FR-03/04 | agent_sessions +origin/aggregation_key/title、logs +agent_session_id、迁移、conftest |
| task-04 | 后端归属服务 | W2 | P0 | task-03 | main | FR-03/04 | schema v2、upsert 归属（hub 关联/entry ctx 分组 find-or-create）、session_id 过滤、pytest |
| task-05 | 后端激活与内容 | W3 | P0 | task-04 | main | FR-05/06 | inject 懒激活（AppError 离线闭环）、origin 下发、内容端点（直连 ws_rpc/黑名单/截断）、pytest |
| task-06 | 前端类型同步 | W4 | P0 | task-05 | main | FR-09 | gen:types |
| task-07 | 前端会话化 | W5 | P0 | task-06 | main | FR-07/08 | sessionId 驱动 + AgentLogSessionBody + 🧾 徽标 + turn_count 分支 + 旧挂载移除 + vitest |
| task-08 | 回归与端到端 | W6 | P0 | task-01,02,07 | 三仓 | 全 FR | 全量回归 + 部署 + 真实链路实证（含变更 B 不串 A） |

## 关键路径
task-03 → 04 → 05 → 06 → 07 → 08（本仓主链）；task-01（跨仓独立）与 task-02（主仓 daemon 目录）同 task-03 并行起步，汇入 task-08。

## 跨仓提交说明
唯一独立仓 sillyspec（task-01，repo+base_commit 锚定直做直提，SillySpec CLI 不 cd 进子仓跑）；sillyhub-daemon 为主仓目录（task-02 随主仓 worktree，plan review P1 修正）；task-08 repo=main 汇总三仓验证。

## 全局验收标准
1. 三仓测试全绿（backend pytest 全量零回归 + 新用例；frontend vitest/tsc/lint；daemon pnpm test；sillyspec node --test）。
2. 端到端实证（runtime-evidence）：①本机直跑 sillyspec（带 --change）→ 平台列表出现 🧾 会话（正确 harness/变更名标题）→ 打开见条目 → 发消息成功派发收到回复；②无 --change 直跑 → ws+harness 单桶会话；③daemon 平台会话内跑 sillyspec → 该会话尾部关联条目；④变更 B 的日志不出现在变更 A 会话；⑤旧 workspace 级流内条目已消失；⑥内容查看（allowed_roots 内 200 含截断 / 外 409 中文）。
3. gen:types 幂等零漂移；合并后回归复跑绿。
