---
author: qinyi
created_at: 2026-08-22 03:28:02
---

# 需求规格（Requirements）— 会话内团队操作

## 角色

| 角色 | 说明 |
|---|---|
| 会话用户 | 在统一会话页与 agent 对话，随时触发/指挥/叫停团队 |
| 主控 agent | 会话中的 Claude agent，常驻团队 MCP 工具，按用户指令编排分身 |
| 分身（worker） | 独立 lease+worktree 的真任务 run，可跨机器/跨工作区 |
| 平台 | backend 编排中枢（mission/run/lease/治理门/patrol） |

## 功能需求

### FR-01: 团队能力归属会话（mission 绑定发起会话）
覆盖决策：D-001@v1, D-006@v1, D-007@v2, D-009@v1
Given 一个 Claude 引擎普通会话已存在
When 用户触发团队（任意路径）
Then 创建的 AgentMission.session_id = 该会话；主控 run = 会话当轮 AgentRun（回填 mission_id + role='orchestrator' 双标记）；治理门/workers 列表/成本统计只计 role!='orchestrator' 的分身 run

Given 同一会话已有未收敛未取消的活跃 mission
When 再次触发预建
Then 返回 409 并提示存在进行中的团队任务（懒建路径由部分唯一索引兜底防并发双建）

### FR-02: 工具常驻注入（Claude 普通会话；分身/Codex 排除）
覆盖决策：D-002@v2, D-003@v1
Given provider='claude' 且 stage ∈ {空, 'orchestrator'} 的交互会话
When daemon 认领 lease 并创建会话
Then 注入 5 个团队 MCP 工具（dispatch_worker/get_worker_result/list_workers/converge_mission/report_progress）

Given provider='codex' 会话，或 stage='mission_worker' 的分身会话
When 会话创建
Then 不注入任何团队工具

### FR-03: 触发四路等价
覆盖决策：D-004@v1
Given Claude 会话输入区
When 用户点「派团队」按钮（弹层配置范围/预算/分身后发送）、或输入 /team 前缀指令、或自然语言要求派团队（含 AskUser 确认变体）
Then 三路最终统一：显式路径走 POST /daemon/sessions/{id}/team-mission 预建（scope 冻结、objective 可空落占位）；自然语言路径由 agent 调 dispatch_worker 懒建（会话有工作区→scope=该工作区；无工作区→422 引导显式选择）

### FR-04: MCP 工具会话定位与收敛语义
覆盖决策：D-009@v1, D-010@v1
Given daemon mcp-server 收到工具调用（参数 mission_id/workspace_id/run_id 均可选）
When 转发 backend
Then 请求携带 X-Session-Id header；backend 优先按会话解析活跃 mission，显式参数仅作越权校验锚；懒建时补回填会话当前活跃 run 双标记

Given 分身 run 未全部终态
When 主控调用 converge_mission
Then 返回 status=busy 引导等待，mission 状态不变

Given 分身 run 全部终态
When converge_mission 被调用
Then converged_at 置位（不依赖主控 run 状态），finalize/合并锚点=该 mission 最新 role='orchestrator' run，mission 进入 done/degraded

### FR-05: 会话结束与团队任务并存
覆盖决策：D-008@v1
Given 会话有 running 分身
When 用户结束会话
Then 分身任务不受影响（独立 lease 存活）；mission 不被取消；派生状态与 patrol 巡检继续推进；重开会话可继续查看任务块与结果

### FR-06: 独立团队入口删除（范围精确）
覆盖决策：D-005@v1, D-011@v1
Given 部署完成
When 访问 /workspaces/[id]/missions 或 /projects/[id]/missions，或查看侧边菜单
Then 路由 404、菜单无「Agent 团队」项；mission-console 组件与 create/list 前后端入口清零；GET /missions/{id} 与 cancel 端点保留（TeamTaskBlock 与 change 详情 team-progress 仍可用）

### FR-07: 会话内团队 UI
覆盖决策：D-001@v1, D-004@v1
Given Claude 会话面板
When 存在团队任务
Then 消息流内嵌 TeamTaskBlock（概要行：状态/N 分身成功失败/花费；展开：主控+分身行、日志/产物入口、取消按钮）；活跃时 5s 轮询刷新；进度视图分身段块（角色/目标工作区徽标/状态/耗时/日志/产物）与 MCP 工具卡正常渲染

Given 团队运行中
When 用户在输入框发送追问
Then 消息进入排队（复用 useMessageQueue），本轮完成自动送达主控

Given Codex 会话
When 查看输入区
Then 「派团队」按钮置灰并提示「团队需要 Claude 引擎」

### FR-08: 状态机矩阵与存量兼容
覆盖决策：D-007@v2, D-009@v1
Given derive_status 判据矩阵（§5 Phase 1 表格）
When 任意主控轮×分身×converge×cancel×session_id NULL 组合
Then 派生状态与矩阵一致；session_id 为 NULL 的存量 external/bootstrap mission 永不进入 awaiting_input（保持 done/degraded/failed，complete_lease 自动收敛不回归）

Given awaiting_input 持续超时（默认 30 分钟）
When patrol 巡检
Then 自动 converge 进入终态

## 非功能需求

- 兼容性：未触发团队的普通会话行为不变（仅系统提示多 5 个工具 schema，R-01 实测）；存量 external mission 链路（change 阶段执行/team-progress）不回归
- 可回退：未上线，revert + 重置开发数据
- 可测试：backend agent/daemon 模块 pytest（derive 矩阵全格、懒建并发、converge busy/置位、治理门判别）；frontend vitest（TeamTaskBlock/触发弹层/Codex 置灰）；daemon vitest（谓词/env 注入/header 透传）
- 平台：Windows/Linux/macOS 兼容（CLAUDE.md 规则 13）
- UI 中文（CLAUDE.md 规则 12）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 会话内能力 | FR-01, FR-07 | 团队归属会话，无独立会话类型 |
| D-002@v2 常驻注入（分身排除） | FR-02 | v2 谓词：claude 且 stage∈{空,'orchestrator'} |
| D-003@v1 一期 Claude 专属 | FR-02, FR-07 | Codex 不注入+按钮置灰 |
| D-004@v1 四路触发 | FR-03, FR-07 | 预建+懒建统一链路 |
| D-005@v1 删独立页面 | FR-06 | 页面/路由/菜单删除 |
| D-006@v1 session_id 列 | FR-01 | 列+索引+部分唯一索引 |
| D-007@v2 worker 链路复用（查询判别） | FR-01, FR-08 | role!='orchestrator' 收窄 |
| D-008@v1 会话结束并存 | FR-05 | patrol 适配+不取消 |
| D-009@v1 主控轮双标记 | FR-01, FR-04, FR-08 | inject/懒建双回填 |
| D-010@v1 converge 语义 | FR-04 | busy/独立置位/新锚点 |
| D-011@v1 删除范围精确 | FR-06 | 保留 get/cancel 端点 |

全部当前版本决策（D-001@v1、D-002@v2、D-003@v1、D-004@v1、D-005@v1、D-006@v1、D-007@v2、D-008@v1、D-009@v1、D-010@v1、D-011@v1）均已覆盖，无剩余风险决策。
