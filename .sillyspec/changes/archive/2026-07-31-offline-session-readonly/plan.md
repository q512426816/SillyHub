---
author: WhaleFall
created_at: 2026-07-31T11:23:11
plan_level: full
---

# 实现计划（Plan）— /runtimes 离线只读浏览会话

> 变更 `2026-07-31-offline-session-readonly` · 方案 A · brainstorm Design Grill passed

## Spike 前置验证

无。brainstorm Design Grill 已逐点核对 design.md 全部代码引用点（runtime-card canOpenSession / page.tsx URL 恢复降级条件 / dialog onlineProviders / panel 4 按钮 disabled + SSE attach + RunErrorItem handleResend / change-session-section 隔离），并修正 3 处事实错误（B1/B2/B3）。无技术不确定性，**跳过 Spike**。

补充确认（execute 锁口径用）：
- `runtime-card.tsx:90-92` canOpenSession = online && (claude|codex)，离线按钮不渲染（根因）。
- `page.tsx:789-808` URL 恢复降级条件 = `matched === null`（非离线）→ **page.tsx 无需改**（B1）。
- `runtime-session-dialog.tsx` dialog `runtime` prop 是 stale 快照，`runtimes` prop 实时 → runtimeOffline 须从 runtimes 重查（B2/D-005）。
- `interactive-session-panel.tsx:444-461` attach effect `establishStream` mount 即建，离线需守卫跳过（B3）；4 按钮 disabled 行号：新建 :982 / 发送 :1202（走 sendingDisabled:891）/ 打断 :1026 / 结束 :1037；RunErrorItem 走 handleResend:726 已有 !hasOnlineProvider 守卫。

## Wave 1 — 入口开放 + offline 只读态（核心）

> 目标：离线时会话按钮可见可点，弹窗内只读浏览列表/历史，4 操作禁用，active 保持 + 重连恢复。

- [x] task-01: `runtime-card.tsx` canOpenSession 放宽（去 online 与运算），离线会话按钮仍渲染 + title/图标只读提示（:90-92, :242-252）（覆盖：FR-01, D-001）
- [x] task-02: `runtime-session-dialog.tsx` 从实时 `runtimes` 重查派生 runtimeOffline 透传 panel（非 stale runtime prop，B2/D-005）（:145-164 附近）（覆盖：FR-02, D-005）
- [x] task-03: `interactive-session-panel.tsx` 加 `offlineReadOnly?: boolean` prop + 顶部离线横幅 + 4 按钮 disabled（新建:982 / 发送:1202 / 打断:1026 / 结束:1037）（覆盖：FR-02, FR-03, D-001）
- [x] task-04: panel attach effect（:444-461）加 offlineReadOnly 守卫跳过 establishStream，直接以 initialTurns 只读渲染，不进 reconnecting 卡超时（B3）（覆盖：FR-02, R1）

## Wave 2 — 测试 + 回归

> 目标：覆盖离线只读各路径 + change-session-section 回归。

- [x] task-05: runtime-card 离线会话按钮渲染 + 点击进 dialog 测试（FR-01）
- [x] task-06: dialog 离线只读测试（列表/历史展示 + 4 按钮 disabled + 离线横幅 + active 保持）（FR-02, FR-03）
- [x] task-07: runtime 重连恢复测试（runtimeOffline 从 runtimes 重查翻转：离线→在线，横幅消失 + 按钮启用 + attach 恢复 SSE）（FR-02, D-005）
- [x] task-08: change-session-section 回归测试（不传 offlineReadOnly，行为不变）（FR-04）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D/R | 说明 |
|---|---|---|---|---|---|---|
| task-01 | runtime-card 离线会话按钮 | W1 | P0 | — | FR-01, D-001 | canOpenSession 去 online |
| task-02 | dialog runtimes 重查 runtimeOffline | W1 | P0 | — | FR-02, D-005 | 非 stale prop，重连生效 |
| task-03 | panel offlineReadOnly prop + 横幅 + 4 按钮 disabled | W1 | P0 | task-02 | FR-02, FR-03 | prop 默认 false 隔离 changes |
| task-04 | panel attach 离线不建 SSE 直接只读 | W1 | P0 | task-03 | FR-02, R1 | 跳过 establishStream，initialTurns 只读 |
| task-05 | runtime-card 离线按钮测试 | W2 | P0 | task-01 | FR-01 | 离线按钮渲染 + 可点 |
| task-06 | dialog 离线只读测试 | W2 | P0 | task-03, 04 | FR-02, FR-03 | 列表/历史 + 4 按钮 disabled + 横幅 + active 保持 |
| task-07 | 重连恢复测试 | W2 | P0 | task-02 | FR-02, D-005 | runtimes 重查翻转 + 恢复 SSE |
| task-08 | change-session-section 回归测试 | W2 | P0 | task-03 | FR-04 | 不传 prop，行为不变 |

## 关键路径

- **离线只读链路**（核心）：task-01（入口）+ task-02（dialog 派生 offline）→ task-03（panel 只读态 + 禁用）→ task-04（SSE 离线跳过）。task-02 是 B2 修正点（runtimes 重查），必须用实时 prop 否则重连失效。
- **重连恢复链路**：task-02（runtimes 重查）→ task-07（测试翻转）。machines 15s 轮询刷新 runtimes → runtimeOffline false → panel 切回在线 + attach 恢复 SSE。
- **隔离链路**：task-03（prop 默认 false）→ task-08（change-session-section 回归）。
- **后端链路**：无（0 改动，API 已 DB 查询）。

## 全局验收标准

- [ ] 离线时 /runtimes 卡片"会话"按钮可见可点，点击进弹窗（task-01, 05）
- [ ] 弹窗离线时：会话列表 + 历史只读展示（DB 数据）、4 操作（新建/结束/打断/发送）disabled、顶部离线横幅（task-03, 06）
- [ ] active 会话离线保持 active 只读（不转 ended），历史 initialTurns 展示（task-04, 06）
- [ ] runtime 重连（offline→online）后：横幅消失 + 按钮启用 + attach 恢复 SSE（task-02, 07）
- [ ] change-session-section 行为不变（不传 offlineReadOnly）（task-08）
- [ ] 后端 0 改动（FR-05：API 已 DB 查询离线可用，无后端 task）、page.tsx 0 改动（B1）
- [ ] frontend vitest 全绿 + tsc typecheck 绿

## 覆盖矩阵（decisions）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（方案 A：panel offlineReadOnly prop） | task-01, 03 | runtime-card 入口开放 + panel prop 横幅禁用 |
| D-002@v1（active 保持只读，非转 ended） | task-03, 04, 06 | active 不改 status + 横幅 + initialTurns 只读 |
| D-003@v1（只 /runtimes，prop 隔离 changes） | task-03, 08 | prop 默认 false + change-session-section 回归 |
| D-004@v1（后端 0 改动） | — | API 已 DB 查询，无后端 task |
| D-005@v1（dialog runtimes 重查 runtimeOffline） | task-02, 07 | 非 stale prop，重连翻转测试 |

## 风险对齐（design §8）

- **R1（active 离线 SSE 断）**：task-04（attach 跳过 establishStream + initialTurns 只读）。
- **R2（重连恢复）**：task-02 + task-07（runtimes 重查 + 翻转测试）。
- **R3（RunErrorItem，已闭环）**：无需 task（handleResend 已守卫），task-06 顺带验证。
- **R4（change-session-section 隔离）**：task-08 回归。
