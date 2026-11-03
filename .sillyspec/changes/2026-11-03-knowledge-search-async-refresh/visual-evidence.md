# 视觉证据 — 2026-11-03-knowledge-search-async-refresh

前端改动 = 知识页搜索区两条纯文案轻提示行（muted-foreground 文本，零布局/交互/组件结构变化）：

| 触发条件（互斥） | 展示文案 | 样式 |
|---|---|---|
| `index_sync === "scheduled"` | 知识库有新变更，已后台同步，当前为存量索引结果 | `text-[11px] text-muted-foreground`，mx-1 mb-2 px-2.5 py-1 |
| `index_sync === "building"` | 知识索引后台建设中，当前为关键词匹配结果 | 同上 |
| fresh / None | 不渲染 | — |

- 无渲染对照截图：两处为条件渲染的纯文本行（复用页面既有 muted-foreground 口径），无尺寸/层级/样式属性新增；`data-testid="knowledge-search-index-sync"` 与条件逻辑可 diff 溯源（page.tsx）。
- 无视觉降级裁决（未触发）。
