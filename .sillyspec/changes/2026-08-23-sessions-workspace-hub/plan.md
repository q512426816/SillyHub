---
author: qinyi
created_at: 2026-08-23 04:33:10
plan_level: full
---

# 实现计划（Plan）— 会话门户工作区中心化与预会话态

## Spike 前置验证
无——技术方案确定性高：D-101 复用链路、§7.5 生命周期零变更、owner_name join 先例均经 Design Grill 源码逐条证实（review-2026-08-23-041902，pass/pass）。

## Wave 1（并行，无依赖）
- task-01
- task-03
- task-04

## Wave 2（依赖 Wave 1）
- task-02

## Wave 3（依赖 Wave 2）
- task-05

## Wave 4（依赖 Wave 3）
- task-06

## Wave 5（依赖 Wave 4）
- task-07

## Wave 6（依赖 Wave 5）
- task-08

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端列表端点 owner_name join users + limit 上限 le=100→500 + pytest | W1 | P0 | — | FR-05, D-108@v2, D-103@v1 | daemon/session/service.py SQL（:2408-2497）join users.username + schema.py AgentSessionRead `owner_name: str \| null` + router.py:1817 le=500 |
| task-03 | SessionPanel 预会话态（同构空态 + null 守卫清单 + 首句 createSession 链路） | W1 | P0 | — | FR-03, D-101@v1, D-102@v1, D-104@v1 | page 分支 :203 null 防御改空态渲染；守卫清单（detailQuery 轮询/dialogs 恢复 effect/SSE/队列激活）；失败保留输入+runtime_id 参数（改造 dialog :2359-2421 复用点） |
| task-04 | pre-session-picker 两步轻选择浮层组件 | W1 | P1 | — | FR-04, D-107@v1 | 在线机器→智能体两步；纯展示组件（useDaemonMachines），门户接线归 task-06 |
| task-02 | 前端 pnpm gen:types 同步 owner_name | W2 | P0 | task-01 | FR-05 | api-types.ts + backend/openapi.json 同变更内提交（CLAUDE.md 规则 21；先确认 node_modules 健康） |
| task-05 | SessionListPanel 工作区树重构 | W3 | P0 | task-02 | FR-01, FR-02, D-103@v1, D-105@v1 | 两层筛选 tab + 分组手风琴 + 机器小节 + owner chip + 状态筛选/批量删除保留（§3 边界）+ 组内 50 截断兜底；数据一次拉取 limit 500 客户端分组 |
| task-06 | SessionsPortal 双态接线 + 上下文解析 + 深链 | W4 | P0 | task-03, task-04, task-05 | FR-03, FR-04, FR-06 | preContext 状态机（优先级：tab 筛选>绑定在线>D-005 回退，resolveDefaultMachineId+LS_KEY 迁入本文件组件外）；空门户态替换表单分支占位；?session= 深链保留；workspace 入口预展开滚动 |
| task-07 | change 入口 preContext + NewSessionForm 退役 + 三页面薄壳 | W5 | P0 | task-06 | FR-06, D-106@v1, D-109@v1 | changeId+workspaceId 显式双传（X-13）；组件+workspace-session-picker+测试迁移清单（R-06 含 app 页面测试），旧断言语义逐条落新家或注明有意删除 |
| task-08 | 全量回归 + Docker 重建部署 + 三入口浏览器实证 | W6 | P0 | task-07 | 全部 FR | vitest/tsc/lint 全量；frontend+backend 镜像 --force-recreate；实证对照原型留档 runtime-evidence |

## 关键路径
task-01 → task-02 → task-05 → task-06 → task-07 → task-08（后端字段→类型→列表树→接线→退役→实证；task-03/04 与 task-01 并行起步，汇入 task-06）

## 全局验收标准
1. 后端 pytest（daemon 列表用例：owner_name 命中/缺失 null/limit 500 边界）+ 前端全量 vitest/tsc/lint 全绿。
2. R-01 专项：预会话态下 SSE effect / detailQuery 轮询 / pending-dialogs 与 dialog-history 恢复 effect / 消息队列投递逐项断言零调用。
3. FR-03 行为：点组头＋→同构聊天界面；首句发送创建成功原地开聊；createSession 失败输入保留可重试；不发言离开左侧列表零新增。
4. 旧会话 owner 缺失 chip 显"—"（brownfield 兜底）。
5. 三入口（全局/工作区深链预展开/变更独立页）+ ?session= 深链浏览器实证，对照原型 v2 留档。
6. NewSessionForm 及其测试全量移除后全仓 grep 零残留引用。

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-101@v1 | task-03, task-06 | AC-2/AC-3（同构空态+原地接管） |
| D-102@v1 | task-03 | AC-3（首句发送即创建+失败保留） |
| D-103@v1 | task-01, task-05 | AC-1（le=500 放宽 + limit 500 客户端分组） |
| D-104@v1 | task-03 | AC-2（上下文行锁定不可编辑） |
| D-105@v1 | task-05, task-06 | AC-3（非工作区组＋D-005 回退） |
| D-106@v1 | task-07 | AC-5（变更独立页+变更名上下文） |
| D-107@v1 | task-04, task-05, task-06 | AC-3/AC-5（两层 tab+两步浮层+优先级链） |
| D-109@v1 | task-07 | AC-6（退役零残留） |
| D-108@v2 | task-01, task-02, task-05 | AC-1/AC-4（owner_name 数据流+chip） |
