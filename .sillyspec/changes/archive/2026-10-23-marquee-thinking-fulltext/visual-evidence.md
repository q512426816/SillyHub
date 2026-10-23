# 视觉证据 — 2026-10-23-marquee-thinking-fulltext

## 用户需求（2026-10-23）

1. 思考条目不能只显示 64 字单行摘要，要展示完整思考内容并流动；
2. 不要循环滚动：从开头一次滚到最后一个字符；
3. 思考是流式输出的，滚动要跟着新增长的内容走，不能停在旧末尾；
4. 仅思考完成时回到开头展示（截断 + 耗时）。

## 实现

- thinking 条目改用 `normalizeText()`（只折叠空白，不截断）；
- 条目内部由组件 rAF 驱动单向滚动：
  - 终点 `marqueeTickerEnd(textWidth, viewWidth)` = 文本末尾贴右缘；
  - 首次从开头滚到当前末尾，**不复制、不循环**；
  - `entry.text` 每次变化 / ResizeObserver 更新终点并继续滚（跟随流式增长）；
  - 落后越多速度越快（220~900px/s），避免追不上；
  - 到达当前末尾停排，文本再增长时重新起排；
- 完成态切换为开头单份截断 + 耗时（回到开头）；
- CSS `.sh-live-marquee-ticker` 删除无限动画，仅保留 `will-change: transform`。

## 核验

- 测试：`turn-live-marquee.test.tsx` 26 用例通过（新增长思考全文、ticker 终点/单份/不循环断言）。
- lint / typecheck 通过。
- 原型验证（Playwright Chromium，端口 3004）：
  - 长思考条目：单份 ticker（`tickerCount=1`）、文本 201 字（不再 64 字截断）、
    文本宽 2139px、窗口 218px、终点 -1921px；
  - 实测 transform `translate3d(-1921px, 0, 0)`——正好停在**最后一个字符**；
  - `animationName: none`——不再使用 CSS 循环动画；
  - 暂停事件流后间隔 1.2s 两次读取 transform 一致，确认已停住（不循环）；
  - 截图 `.proto-staging/marquee-thinking-fulltext.png`：可见思考末尾片段与转圈。
  - 文本流式增长时由 `entry.text` 变化 effect / ResizeObserver 继续更新终点并重启滚动；
    思考完成后切换为开头截断 + 耗时。
