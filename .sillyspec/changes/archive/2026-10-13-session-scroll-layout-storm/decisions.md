---
author: flow-machine-draft
created_at: 2026-10-13T02:58:21.501Z
---
# 决策记录（Decisions）— 2026-10-13-session-scroll-layout-storm

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：rAF 合帧使钉回延迟至多一帧（16ms）——极端高惯性滚动下视口可能瞬时偏移一帧再被拉回，视觉上理论可感（单帧偏移 ≤ 一帧滚动量，watch interval 300ms 兜底跟进）；实测路径（webview 全场景回归）未观察到可感差异，Chrome 上的最终验证依赖用户复测（部署后由用户在原崩溃路径确认）。 试过但放弃的方案：① 删除钉回重申（anchorPinRef 机制）——回归 ql-20260916-019 修复的「未知写入者拉走视口」问题；② IntersectionObserver 重构 activeTurn 联动——联动已有 rAF 节流非风暴源，重构改动面大风险不成比例；③ 同时合并单页 4 份 useDaemonMachines 轮询——确认存在的独立问题，混入本变更扩大审查面，另立变更；④ 给 handleLoadEarlier 锚捕获段（全量行 rect 遍历）也做合帧——经核查它在 fetch await 之后、不在 scroll 事件栈内、每页至多一次，非反馈环成员，不动（禁止扩大改动面）。
