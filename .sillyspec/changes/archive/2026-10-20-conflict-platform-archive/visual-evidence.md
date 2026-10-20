# 视觉证据（visual-evidence）— 2026-10-20-conflict-platform-archive

## UI 面变更与验证口径

本变更 UI 面唯一改动：`conflict-compare-modal.tsx` 的 `renderSpecTreeBody` 新增
`record_label === "platform-archive"` 来源横幅（`data-testid="compare-archive-source"`）。

- **真码契约**：横幅为真实组件内实现（非手绘/独立原型），与同函数内紧邻的
  full-tree 横幅（`compare-record-source`，2026-10-16 上线）同方言同款样式
  （`border-b bg-muted/60 px-5 py-1.5 text-xs text-muted-foreground` 固定说明行、
  无关闭控件）——复用页内既有模式，零新样式面。
- **验证方式**：本组件的既定验证方言为 vitest + testing-library 组件套件——
  `conflict-compare-modal.test.tsx` 新增用例断言横幅文本三要素（本机冲突记录已
  不存在 / 平台留档快照 / 平台侧为当前内容）+ 覆盖变更数 + 与 full-tree 横幅
  互斥（record_label 单值）。套件 20/20 绿（2026-10-20 08:32 本地跑）。
- **无视觉降级**：未发生结构收敛/范围缩小/样式统一级妥协，无需用户裁决项。
