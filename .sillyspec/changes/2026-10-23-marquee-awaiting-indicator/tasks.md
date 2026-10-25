---
author: flow-machine-draft
created_at: 2026-10-25T01:40:31.608Z
---
# 任务注册表（Tasks）— 2026-10-23-marquee-awaiting-indicator

- [x] task-01: 等待态推导（latest 非 running）+ Sparkles 图标 +「等待模型响应 · 耗时」合成条目，1s 计时（FR-01）
- [x] task-02: 渲染层拼接，不进 entries/计时/滑动检测；新事件到达立即消失并清零（FR-02）
- [x] task-03: 最新条 running 不显示；reduced-motion 静态显示（FR-03）
- [x] task-04: 新增出现/消失测试，29 用例通过；lint / typecheck 通过（FR-04）
- [x] task-05: 原型「暂停事件流」演示等待条目出现与消失（FR-01/FR-02）

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx |
| 修改 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx |
| 修改 | frontend/src/app/proto/session-live-marquee/page.tsx |
| 新增 | .sillyspec/changes/2026-10-23-marquee-awaiting-indicator/visual-evidence.md |
