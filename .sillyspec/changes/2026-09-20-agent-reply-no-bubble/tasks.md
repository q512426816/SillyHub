---
author: qinyi
created_at: 2026-09-20 17:47:15
---
# 任务清单（Tasks）

- [x] task-01: v2 主路径去气泡——TextSegmentView 容器 `.seg-text-bubble` → 无框 `.seg-text-body`（max-w min(100%,48rem)）+ 删 SEGMENT_ANIMATION_CSS 子代理透明化补丁（target: frontend/src/components/daemon/turn-segment-views.tsx）
- [x] task-02: 旧路径同步——turn-timeline 旧数据答复气泡换同款无框容器（内容自适应宽度不取 w-full，行尾时间戳尾随语义保持）（target: frontend/src/components/daemon/turn-timeline.tsx）
- [x] task-03: globals.css mobile 规则迁 `.seg-text-body`（仅字号/行高，不带 max-width）+ 注释同步 + 测试断言更新与无框形态新增断言（depends_on: task-01, task-02）（target: frontend/src/app/globals.css, frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx）
