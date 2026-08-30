---
author: qinyi
created_at: 2026-08-22 03:28:02
---

# 提案书（Proposal）— 会话内团队操作

## 动机

团队任务（AgentMission）与统一会话体验割裂：独立页面、一次性指令、发起后无法沟通。用户期望团队是**当前会话内 agent 的一种能力**——像子代理一样，当前对话的 agent（主控）随时通过 MCP 工具派分身（worker，跨机器/跨工作区真任务），分身进度与结果直接回到当前消息流，全程不离开对话（交互原型 v2 已评审通过）。

## 关键问题

1. **发起后断联**：旧链路为团队另起专属主控会话 + 一次性渲染 prompt；「用团队分析」按钮传的 session_id 是无人消费的死参数——任务与发起会话完全断联，用户在会话里说了什么团队不知道。
2. **无法继续沟通**：团队页面无输入框，只能 10 秒轮询围观或取消；普通会话已有的追问/排队/打断基建与团队链路互不相通。
3. **基建存在但未接线**：daemon 已具备按会话注入团队 MCP 工具的机制（仅用于 stage=orchestrator 的新会话）、worker 已具备独立 lease/worktree/预算治理——缺的只是"把工具给到正在聊的会话、把 mission 绑到发起会话"。

## 变更范围

- backend：AgentMission 加 session_id 列（+活跃态部分唯一索引）；会话维度触发/列表端点；inject 当轮 run 双标记（mission_id+role=orchestrator）；MCP 工具按 X-Session-Id 定位+懒建；converge 语义重定义；derive_status 增 awaiting_input（存量守卫）；治理门/patrol 判别适配。
- daemon：注入谓词放宽（Claude 普通会话常驻、分身 stage 常量化排除）；MCP server env 注入 MCP_SESSION_ID + 请求 X-Session-Id；工具参数可选化+描述重写。
- frontend：会话面板输入区「派团队」按钮+配置弹层+状态 chip；/team 指令；TeamTaskBlock 消息流任务块；进度视图分身段块；删除独立 missions 页面/路由/菜单。
- 详见 design.md §6 文件变更清单（30 项）。

## 不在范围内（显式清单）

- 不做 Codex 引擎 MCP 注入（后续变更；一期 Codex 会话按钮置灰）
- 不做团队任务块 SSE 实时推送（一期 5s 轮询）
- 不做历史 mission 数据迁移（项目未上线允许重置）
- 不改 worker 派发链路规则（worktree/scope 校验/预算扣减；仅查询加主控轮判别）
- 不做多会话共享一场团队任务
- 不动 team-progress.tsx 在 change 详情页的既有用法

## 成功标准（可验证）

- 在任意 Claude 引擎普通会话中，通过按钮/‌/team/自然语言触发团队，agent 能调用 dispatch_worker 派出分身（分身出现在 TeamTaskBlock）
- 团队运行期间输入框追问进入排队，本轮完成自动送达主控；主控可动态加派/收敛
- 分身全部完成后 mission 进入 awaiting_input，agent 调 converge（或 patrol 超时自动收敛）→ 结论回流消息流
- 会话结束时分身任务不被取消，重开会话可继续查看/操作
- Codex 会话与分身会话不注入团队工具
- 存量 external mission 链路（change 阶段执行）行为不回归（derive/complete_lease 自动收敛）
- /workspaces/*/missions、/projects/*/missions 路由与「Agent 团队」菜单消失，全仓无 dangling 引用
- backend agent 模块 pytest、frontend vitest、daemon vitest 全绿
