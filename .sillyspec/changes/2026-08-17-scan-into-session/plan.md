---
author: qinyi
created_at: 2026-08-17 14:05:00
plan_level: full
---

# 实现计划（Plan）— 扫描统一到会话

> 决策覆盖：D-001@v1（方案 A）、D-002@v1（入口留配置卡）、D-003@v1（移除控制台）、D-004@v1（Grill 修订）。无 Spike 前置验证——核心机制已由 Design Grill 独立子代理逐项代码核实成立（AgentSession 未绑 workspace_id、ScanGenerateResponse 缺 session_id、AgentSessionListItem 缺 mode、会话列表按 workspace_id 过滤、首 turn user_input 落库），无技术不确定性。

## Wave 1（并行，无依赖 — 后端三件，文件不重叠）

- [ ] task-01: 后端 — start_scan_dispatch 的 AgentSession 补绑 workspace_id（覆盖：FR-01, D-001@v1）
- [ ] task-02: 后端 — scan_generate 返回 session_id（含早返回分支）+ router 端点回填（覆盖：FR-02, D-001@v1）
- [ ] task-03: 后端 — AgentSessionListItem 补 mode（agent/router 工作区组装点 + change/router 变更级组装点）（覆盖：FR-07, D-001@v1）

## Wave 2（依赖 Wave 1 — 类型同步）

- [ ] task-04: 类型同步 — pnpm gen:types（api-types.ts + openapi.json）+ daemon.ts 手写 AgentSessionListItem 补 mode（覆盖：FR-02, FR-07, D-001@v1）

## Wave 3（并行，依赖 Wave 2 — 前端三件，文件不重叠）

- [ ] task-05: 前端 — 配置卡扫描成功后跳转会话页（router.push ?session=），移除内嵌运行面板（覆盖：FR-03, D-002@v1）
- [ ] task-06: 前端 — 会话页深链 attach（?session= 读取 + 竞态处理 + 未命中直接加载）（覆盖：FR-04, D-002@v1）
- [ ] task-08: 前端 — 移除智能体控制台（agent 页、page.tsx/components 页导航、menu-permissions 菜单组、use-agent-runs 及其测试）（覆盖：FR-06, D-003@v1, D-004@v1）

## Wave 4（依赖 Wave 3 的 task-06 — 与 task-06 共享 workspace-session-section.tsx，必须分 Wave）

- [ ] task-07: 前端 — 会话列表扫描徽标（session-list-layout 补 kind + workspace-session-section 传值）（覆盖：FR-05, D-001@v1）

## Wave 5（依赖 Wave 3/4 — 测试清理收尾）

- [ ] task-09: 测试适配与清理（后端解包三元组/mode 断言；前端 menu-permissions/permission/page.test 断言清理；borrow-trigger-contract 保留）（覆盖：FR-01..FR-07, D-001@v1..D-004@v1）

## Wave 6（依赖全部 — 全量验证）

- [ ] task-10: 全量验证（backend pytest 模块级 + frontend vitest + lint + typecheck + 死链 grep 复查）（覆盖：全局验收）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | AgentSession 补绑 workspace_id | W1 | P0 | — | FR-01, D-001@v1 | agent/service.py 构造处一行 + 单测 |
| task-02 | scan_generate 返回 session_id | W1 | P0 | — | FR-02, D-001@v1 | workspace/service.py 三元组（含早返回）+ schema + router |
| task-03 | AgentSessionListItem 补 mode | W1 | P0 | — | FR-07, D-001@v1 | daemon/schema.py + agent/router.py + change/router.py 两组装点 |
| task-04 | 类型同步 gen:types | W2 | P0 | task-02,03 | FR-02, FR-07 | api-types.ts + openapi.json + daemon.ts 手改 |
| task-05 | 配置卡跳转会话页 | W3 | P0 | task-04 | FR-03, D-002@v1 | workspace-config-card.tsx handleScan + 测试 |
| task-06 | 会话页深链 attach | W3 | P0 | task-04 | FR-04, D-002@v1 | workspace-session-section.tsx + 测试 |
| task-07 | 会话列表扫描徽标 | W4 | P1 | task-03,06 | FR-05, D-001@v1 | session-list-layout.tsx kind + section 传值 |
| task-08 | 移除智能体控制台 | W3 | P0 | — | FR-06, D-003@v1, D-004@v1 | 页面/导航/菜单组/use-agent-runs + 死链 grep |
| task-09 | 测试适配与清理 | W5 | P0 | task-01..08 | 全部 FR/D | 后端三元组/mode 断言、前端测试清理、borrow 保留 |
| task-10 | 全量验证 | W6 | P0 | task-01..09 | 全局验收 | pytest + vitest + lint + typecheck + 死链复查 |

## 关键路径

task-01/02/03 → task-04 → task-06 → task-07 → task-09 → task-10（最长路径；task-05 与 task-08 在 W3 并行，不占关键路径）。task-06 与 task-07 共享 `workspace-session-section.tsx`，已强制分 Wave（W3 → W4）防并行覆盖。

## 全局验收标准

- [ ] 后端：`start_scan_dispatch` 创建的 AgentSession.workspace_id == 目标工作区；`scan_generate` 返回三元组（含早返回分支 session_id 取自 existing_run.agent_session_id，老 run 为 None）；`AgentSessionListItem.mode` 两组装点均填充
- [ ] 前端：配置卡扫描确认后 `router.push(/workspaces/{id}/sessions?session={id})`（session_id null 仅跳转不深链）；会话页 `?session=` 深链 attach 生效（含列表未加载竞态）；mode=scan 会话显示「扫描」徽标
- [ ] 智能体控制台完全移除：全仓 grep `href: "agent"`（指向 /workspaces/{id}/agent）与 `workspaces/\$\{.*\}/agent` 零死链；任务 run 任务详情页、阶段 run 变更详情页执行日志可见
- [ ] `borrow-trigger-contract.test.ts` 保留且通过（scanGenerate 仍是触发入口契约）
- [ ] （brownfield）非 scan 会话（chat）列表/attach/reopen 行为不变
- [ ] backend pytest（模块级）+ frontend vitest + lint + typecheck 全绿；gen:types 产物已提交

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, 02, 03, 04, 07 | 后端 workspace_id/session_id/mode 断言；徽标渲染断言 |
| D-002@v1 | task-05, 06 | 配置卡 router.push 断言；会话页深链 attach 测试 |
| D-003@v1 | task-08 | 页面/菜单/导航删除 + 死链 grep 为零 |
| D-004@v1 | task-08, 09 | 导航入口纳入文件清单 + R6 风险缓解落实 |
