---
author: flow-machine-draft
created_at: 2026-10-23T03:30:49.001Z
---
# 任务注册表（Tasks）— 2026-10-23-marquee-motion-polish

- [x] task-01: 轨道速度改 `marqueeSpeedForDistance` 缓出曲线（40~1600px/s），接近目标自然减速（FR-01）
- [x] task-02: 运行中文本窗口加左右 10px mask 渐隐；完成态不加；滚动维持 3s（FR-02）
- [x] task-03: 流光改 22% 宽 + blur(6px) + 低对比 + 6.5s 周期（FR-03）
- [x] task-04: reduced-motion 下流光/内部滚动保持关闭，静态可读（FR-04）
- [x] task-05: 新增速度纯函数单测；22 用例回归 + lint / typecheck 通过（FR-05）

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx |
| 修改 | frontend/src/app/globals.css |
| 修改 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx |
| 新增 | .sillyspec/changes/2026-10-23-marquee-motion-polish/visual-evidence.md |
