---
author: flow-machine-draft
created_at: 2026-10-23T01:35:34.775Z
---
# 任务注册表（Tasks）— 2026-10-23-marquee-item-detail

- [ ] task-01: 条目图标改 lucide 组件映射（去 emoji glyph），运行中右侧 CSS 转圈，文本区双份 CSS 横向循环（FR-01）
- [ ] task-02: 完成条目停止滚动、截断文本、Timer 图标 + 格式化耗时；进行中不显示耗时（FR-02）
- [ ] task-03: 工具/子代理用段 startedAt/endedAt 求差；thinking 客户端计时；无数据不伪造（FR-03）
- [ ] task-04: 条目宽度 16rem，图标/耗时固定、仅文本区滚动（FR-04）
- [ ] task-05: reduced-motion 关闭内部滚动与转圈，静态展示（FR-05）
- [ ] task-06: 更新跑马灯测试（图标/转圈/耗时/布局/降级），跑相关测试 + lint + typecheck（FR-06）

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx |
| 修改 | frontend/src/app/globals.css |
| 修改 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx |
| 修改 | frontend/src/app/proto/session-live-marquee/page.tsx（原型演示进行中/完成/耗时） |
| 新增 | .sillyspec/changes/2026-10-23-marquee-item-detail/visual-evidence.md |
