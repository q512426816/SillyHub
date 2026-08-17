---
author: qinyi
created_at: 2026-08-17 13:55:00
---

# 提案书（Proposal）— 扫描统一到会话

## 动机

工作区「扫描」目前由「智能体控制台」（`/workspaces/{id}/agent`）承载：页面展示 run 列表 + 实时日志，用户点击「启动扫描」派发一个 AgentRun。但底层事实是——`start_scan_dispatch` 已经创建 `AgentSession`（config.mode="scan"，走 interactive lease + SESSION_INJECT 首 turn 注入，AskUserQuestion 真阻塞等人审），只是该会话**未绑定 workspace_id**，且前端展示走 run 日志视图而非会话视图。与此同时，变更中心已完全会话驱动（删了「+新建变更」，agent 在会话里自动立项并推进）。扫描停留在 run 视角，与平台的会话驱动模型不一致。

## 关键问题

1. **扫描会话不可见**：scan 的 AgentSession 未绑 `workspace_id`（`agent/service.py:1709`），工作区会话列表按 `workspace_id` 过滤（`agent/router.py:605`）永远看不到 scan 会话——用户无法在会话页 attach/干预/审批扫描过程。
2. **双概念割裂**：变更中心是会话驱动，扫描是 run 驱动，同一平台两种交互范式；「智能体控制台」成为唯一残留的 run 视角页面。
3. **交互能力浪费**：scan 底层已是 interactive session（SSE 实时、AskUserQuestion 审批、reopen 恢复），但用户只能看到 run 日志视图，用不上会话能力。

## 变更范围

- 后端：`start_scan_dispatch` 的 AgentSession 补绑 `workspace_id`；`scan_generate` 返回 session_id（含早返回分支）；`ScanGenerateResponse` 补 `session_id`；`AgentSessionListItem` 补 `mode`（工作区 + 变更级两个组装点）。
- 前端：配置卡扫描成功后跳转会话页并深链 attach scan 会话；会话列表展示「扫描」徽标；移除智能体控制台（页面、快捷导航、侧边栏菜单组、仅其使用的模块）。
- 测试：后端断言 workspace_id/session_id/mode；前端断言跳转/深链/徽标；删除相关测试清理。

## 不在范围内（显式清单）

- 不重构 scan dispatch 为 `create_session` 变体（方案 C 不做）。
- 不在会话页新增「启动扫描」按钮（入口保留在配置卡）。
- 不迁移移动端 `/m/workspaces` 扫描相关文案（无启动入口，仅策略标签）。
- 不在工作区级提供跨 run 聚合历史视图。
- 不改变 scan 指令内容 / 扫描流程本身（bundle 构建、postSpecSync、scan_docs reparse 均不动）。

## 成功标准（可验证）

- 扫描触发后，工作区会话列表出现带「扫描」徽标的会话（mode=scan），可 attach 查看实时日志。
- 配置卡点击扫描（确认后）跳转 `/workspaces/{id}/sessions?session=<id>` 并自动 attach。
- 扫描中的 AskUserQuestion 审批照常在 approvals 页聚合可审批。
- 扫描会话结束后可 reopen 继续对话。
- 智能体控制台页、其快捷导航、侧边栏菜单组全部移除，无死链（grep `href: "agent"` / `"/agent"` 为零）。
- 任务 run 在任务详情页、阶段 run 在变更详情页执行日志可见（既有视图不变）。
- 前后端测试全绿（backend pytest 模块级 + frontend vitest + lint + typecheck）。
