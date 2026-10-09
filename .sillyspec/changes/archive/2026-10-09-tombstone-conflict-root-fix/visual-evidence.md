---
author: qinyi
created_at: 2026-10-09 13:12:40
---

# UI 视觉证据 — 2026-10-09-tombstone-conflict-root-fix

> 探针 12（warn 档）：变更含前端渲染分支，落盘渲染对照证据。本变更 UI 面=变更中心「平台同步」卡冲突行的**新增渲染分支**（墓碑形态），页面骨架/卡片布局/ghost 区零改动。

## 对照基准

- 原型（brainstorm step5 用户确认版）：`prototype-tombstone-conflict-row.html`（三态：普通版本冲突行〔现状不动〕/ 墓碑行〔新〕/ 收敛回显〔新〕）
- 实现落点：`frontend/src/components/changes/platform-sync-section.tsx`（renderRows 墓碑分支）

## 三态对照结论

| 原型态 | 实现锚点 | 一致性 |
|---|---|---|
| 状态一 普通版本冲突行（spec 徽章/名称/时间/查看对比/活跃警示） | 现状渲染分支（renderRows 非 isTomb 行原路径，qlId/createdAt 字段透传修正） | 一致（不动原型态） |
| 状态二 墓碑行（「平台已删」error 徽章 + 被删变更名〔真凶〕+ 发现于相对时间 + 非版本冲突 note + 隐藏查看对比/裁决 + 「收敛本机目录」按钮含隔离区 title） | `data-testid="platform-sync-tombstone-row"` 分支（badge/converge/note 三 testid） | 一致（徽章文案/按钮文案/note 文案与原型逐字对齐；样式走主题 token error 阶，无 hex） |
| 状态三 收敛回显（已下发等待→已收敛等待快照刷新/失败红字/150s 恢复） | pendingMap `tombstone_cleanup:<change>` 回显链（复用 ECHO_TIMEOUT/ECHO_FAST_POLL + rowStateText tombstone 文案分支） | 一致（文案「已收敛 · 等待快照刷新（≤75 秒）」对齐原型「已收敛」态） |

## 测试证据（渲染断言，非目测）

`frontend/src/components/changes/__tests__/platform-sync-section.test.tsx` 墓碑 describe 5 用例：
1. 墓碑行渲染断言（badge 文本「平台已删」+ salv 在场 + 查看对比缺席 + converge 按钮在场 + 非版本冲突 note）
2. 混合行反例（差集非空走版本冲突渲染——查看对比保留，反例锚）
3. 注册表独有墓碑行（快照无对应行也渲染）
4. 收敛下发→waiting→心跳回报→succeeded 全链（文案断言）
5. 快照 type=tombstone 透传兜底（无注册表数据）

套件 20 绿（含 15 既有回归）；tsc/lint 0。
