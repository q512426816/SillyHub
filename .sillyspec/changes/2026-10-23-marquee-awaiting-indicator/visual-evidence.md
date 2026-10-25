# 视觉证据 — 2026-10-23-marquee-awaiting-indicator

## 用户需求（2026-10-23）

1. 为什么只有思考条目在转圈？（答复：所有 running 条目都转圈，工具运行窗口短、
   思考是分钟级，故视觉上多见思考转圈）
2. 工具执行完成后、下一段未到之间的"卡住"时间（LLM 正在生成），希望也能看到在做什么。

## 实现

- 等待态判定：组件仅被运行中轮次渲染，故「最新真实条目非 running」即 LLM 生成间隙。
- 追加合成条目 `marquee-awaiting`：Sparkles 图标 +「等待模型响应 · 耗时」+ 转圈，
  耗时每秒递增（复用 `formatMarqueeDuration`）。
- 仅渲染层拼接：不进 entries / 客户端计时 Map / 窗口滑动检测；新事件到达或回到
  running 即消失并清零计时。
- reduced-motion：静态文本 + 静止圆环，计时照常更新。
- 原型「暂停事件流」把 live-thinking 置完成态，演示等待条目出现/消失。

## 核验

- 测试：`turn-live-marquee.test.tsx` 29 用例通过
  （新增：等待出现 / running 不出现 / 新事件到达消失；既有 4 用例按新行为更新断言）。
- lint / typecheck 通过。
- 原型验证（Playwright Chromium，端口 3005）：
  - 正常流动（思考 running）：等待条目 0、思考条目 1 个转圈；
  - 暂停事件流（模拟 LLM 间隙）：等待条目出现「等待模型响应 · 1.0s」→ 2.5s 后
    递增到「3.0s」，带转圈（截图 `.proto-staging/marquee-awaiting.png`）；
  - 恢复事件流：等待条目消失（count=0）。
