---
author: flow-machine-draft
created_at: 2026-10-30T00:49:06.115Z
---
# 任务注册表（Tasks）— 2026-10-30-marquee-awaiting-loop-scroll

- [x] task-01: 测试先行：turn-live-marquee.test.tsx 新增用例——wrapLoopOffset 回卷纯函数（区间内不动/越下界回卷/宽度变化折回）+ marquee-awaiting 循环模式双份文本渲染 + reduced-motion 下 awaiting 静态截断；跑测试确认新用例红（实现未写）
- [ ] task-02: 实现 MarqueeItemView scrollMode="loop" 分支：双份相同文本（第二份 aria-hidden+固定间隔）、TICKER_LOOP_SPEED=72px/s 恒速 rAF、offset 达 -周期宽度时 wrapLoopOffset 回卷、entry.text 变化/ResizeObserver 重测周期宽度并折回区间；marquee-awaiting 渲染处传 scrollMode="loop"
- [ ] task-03: 验证绿：跑 turn-live-marquee.test.tsx 全量（既有用例不改断言全绿+新用例绿）+ frontend lint 通过；真实页面肉眼确认一轮循环无空白区段，结论记 visual-evidence.md
