---
author: qinyi
created_at: 2026-08-17 13:55:00
---

# 决策记录（Decisions）— 扫描统一到会话

## D-001@v1: 方案 A — 会话收敛·最小侵入
- type: architecture
- priority: P0
- status: accepted
- supersedes:
- source: user
- question: 三种实现方案（A 会话收敛 / B 保留聚合视图 / C 统一 create_session 变体）选哪个？
- answer: 用户选择方案 A——scan 的 AgentSession 补绑 workspace_id + 响应补 session_id，前端接入会话视图；不重构 dispatch 链路。
- normalized_requirement: scan 触发后成为工作区级会话（mode=scan），可 attach/审批/reopen；ScanGenerateResponse 含 session_id。
- impacts: [FR-01, FR-02, FR-04, FR-07, task-01, task-02, task-03]
- evidence: brainstorm Step 4 用户选择「方案A（推荐）」（2026-08-17）

## D-002@v1: 扫描入口留在配置卡，触发后进入会话页
- type: boundary
- priority: P0
- status: accepted
- supersedes:
- source: user
- question: 「启动扫描」入口放哪里？（配置卡 / 会话页 / 两处）
- answer: 用户自定义回答「留在配置卡，点击确认后直接进入会话，然后按会话操作执行」——配置卡保留触发，确认后跳转会话页深链 attach scan 会话；会话页不新增启动按钮。
- normalized_requirement: 配置卡 handleScan 成功后 router.push(/workspaces/{id}/sessions?session={session_id})；会话页支持 ?session= 深链。
- impacts: [FR-03, FR-04, task-05, task-06]
- evidence: brainstorm Step 3 用户自定义回答（2026-08-17）

## D-003@v1: 智能体控制台完全移除
- type: boundary
- priority: P0
- status: accepted
- supersedes:
- source: user
- question: 「智能体控制台」页面怎么处理？（完全移除 / 降级只读运行历史 / 并入会话页）
- answer: 用户选择「完全移除」——任务 run 归任务详情页、阶段 run 归变更详情页执行日志（均有既有视图）。
- normalized_requirement: 删除 /workspaces/{id}/agent 页、快捷导航、侧边栏菜单组及仅其使用的模块；不留死链。
- impacts: [FR-06, task-08, task-09]
- evidence: brainstorm Step 3 用户选择「完全移除（推荐）」（2026-08-17）

## D-004@v1: Design Grill 修订（P1-1/P1-2 + P2-1..P2-5 全部解决）
- type: consistency
- priority: P1
- status: accepted
- supersedes:
- source: design-grill
- question: 独立审查子代理 verdict=qualityVerdict fail——文件清单遗漏侧边栏菜单组与 components 页导航等
- answer: 全部纳入 design.md 修订：menu-permissions.ts 菜单组 + components/page.tsx NAV_ITEMS 入文件清单；borrow-trigger-contract.test.ts 保留；mode 两组装点；深链竞态处理；page.test.tsx 测试计划；session-list-layout kind；风险新增 R6。
- normalized_requirement: 移除智能体控制台必须同时删除/迁移全部导航入口（sidebar 菜单组、快捷导航、组件页导航），引用核查含导航 grep。
- impacts: [FR-06, task-08, task-09]
- evidence: brainstorm Step 7 独立子代理 review.json + design.md 修订（2026-08-17）
