# 视觉证据 — 2026-10-25-marquee-subagent-outer-only

## 用户需求（2026-10-25）

子代理内部消息不要进外部跑马灯；外部只显示子代理名称 + 运行状态 + 时间；
内部消息留在对话流的子代理卡片（框框）内展示。

## 实现

1. **外部收敛**：`deriveLiveMarqueeEntries` 的 tool（带 children）与 subagent_stub 分支
   删除 children 递归——外部只保留容器条目；子代理卡片路径（SubagentBlockView）零改动。
2. **运行中走秒计时**：统一 1s tick；running 条目右侧「转圈 + ⏱ Ns」，
   起点优先段 startedAt、缺省客户端首次观察时刻；完成后显示总耗时（现状）。
3. **SSR 水合一致**：elapsed 仅挂载后渲染（elapsedMounted 门控），避免服务端/客户端
   时间差导致 hydration mismatch。

## 核验（Playwright Chromium，端口 3005）

- `innerLeak: []`——子代理内部工具（Grep keepalive / Bash nginx.conf）不出现；
- 外部仅容器条目「子代理 · Agent 排查后端超时配置」（完成态显示 ⏱ 3.8s）；
- 运行中长思考条目末尾「⏱ 2.0s」走秒 + 转圈（客户端起点兜底）；
- 工具完成条目照常显示总耗时（1.2s / 820ms / 1.6s）；
- 无 hydration 错误（首验曾报，elapsedMounted 门控后消除）；
- 截图 `.proto-staging/marquee-subagent-outer.png`；
- 测试：`turn-live-marquee.test.tsx` 31 用例通过（子代理递归用例改写为「不进入外部轨道」，
  新增走秒计时 2 用例）；lint / typecheck 通过。
