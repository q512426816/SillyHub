---
author: WhaleFall
created_at: 2026-07-31T13:03:15
task: archive
type: module-impact
---

# 模块影响分析（Module Impact）— /runtimes 离线只读浏览会话

> 变更 `2026-07-31-offline-session-readonly`（方案 A：panel offlineReadOnly prop + active 保持只读）

## 三重交叉验证

| 来源 | 范围 |
|---|---|
| 声明范围（design §5 文件清单） | 3 前端文件：runtime-card + runtime-session-dialog + interactive-session-panel |
| 任务范围（plan task-01~08） | 同上 + 3 测试文件 |
| 真实变更（worktree commit 054155b2，git diff） | 3 源码 + 3 测试，6 文件 |

**以 git diff 为准**，三重一致，无遗漏、无超范围（page.tsx / 后端 / change-session-section 零改）。

## 真实变更文件（worktree 054155b2）

```
frontend/src/components/daemon/runtime-card.tsx                          (task-01)
frontend/src/components/daemon/runtime-session-dialog.tsx                (task-02)
frontend/src/components/daemon/interactive-session-panel.tsx             (task-03, task-04)
frontend/src/components/daemon/__tests__/runtime-card-offline.test.tsx        (task-05, 新)
frontend/src/components/daemon/__tests__/interactive-session-panel-offline.test.tsx (task-06, 新)
frontend/src/components/daemon/__tests__/runtime-session-dialog-reconnect.test.tsx (task-07, 新)
```

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| daemon | 逻辑变更 | `frontend/src/components/daemon/{runtime-card,runtime-session-dialog,interactive-session-panel}.tsx` + tests | 离线只读浏览：runtime-card 会话按钮离线仍显示（canOpenSession 去 online）；dialog 从实时 runtimes 重查派生 runtimeOffline 透传 panel（D-005）；panel 加 offlineReadOnly prop + 顶部离线横幅 + 4 操作（新建/发送/打断/结束）disabled + attach 离线不建 SSE 直接 initialTurns 只读（active 保持）。重连自动恢复。 | false |

## 未匹配文件

无（仅 daemon 前端组件 + 测试，无跨模块文件）。

## 跨模块影响

- **daemon（前端）内部**：runtime-card → runtime-session-dialog → interactive-session-panel 三组件协同（入口开放 → 派生 offline → 只读态）。InteractiveSessionPanel 是共享组件，加可选 `offlineReadOnly` prop（默认 false）→ change-session-section 不传，原行为不变（D-003 隔离）。
- **不改**：后端 API（DB 查询离线可用，D-004）、page.tsx（URL 恢复已支持离线，B1）、change-session-section、状态机/生命周期。

## needs_review 汇总

daemon 模块本次改动明确（设计 + 实跑测试均闭环），needs_review = false。建议 step 3 同步更新 `modules/daemon.md`（离线只读浏览机制）。
