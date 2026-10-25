# 视觉证据 — 2026-10-25-subagent-card-unify-panel

## 用户需求（2026-10-25 两轮澄清）

1. 子代理卡片去掉弹窗内原地展开形态，统一「紧凑卡片 + 右侧详情栏/Drawer」；
2. 澄清修订：子代理**内部信息要在框框内流动展示**（与会话跑马灯同款机制）；
   外部会话跑马灯只显示「子代理：名称 状态 执行时间」。

## 实现

1. `SubagentBlockView` 删内联展开分支：有面板上下文 → 紧凑卡片（点击开右栏/Drawer）；
   无上下文 → 同款头部纯展示（不可点击）。
2. `TurnLiveMarquee` 新增 `layout="inline"` 变体（w-full / h-7 / 贴卡片底色 / 独立 testid）
   与 `testId` prop；`SubagentBlockView` 头部下方嵌 `deriveLiveMarqueeEntries(children)`
   流动条——内部过程在框内流动（运行中转圈/走秒/等待指示），children 为空不渲染。
3. `session-panel-dialog` 挂 `SubagentPanelContext.Provider`：点击卡片右侧滑出
   antd Drawer（`min(92vw, 420px)`，与 page 移动端同构），内嵌 `SubagentDetailPanel`；
   段失效自动关闭。

## 核验（Playwright Chromium，端口 3005；截图 marquee-subagent-card.png / marquee-subagent-drawer.png）

- **外部跑马灯**：`hasContainer=true`（「子代理 · Agent」容器条目）、`innerLeak=false`
  （内部工具 Grep/Bash 不出现在外部）；
- **子代理卡片**：头部「🤖 排查后端超时配置 Explore 00:04」+ 内嵌流动条
  「搜索 · Grep keepalive · nginx/** 800ms → 运行命令 · Bash grep -n keepalive 1s →
  等待模型响应 · 2.0s（转圈）」——内部过程在框内实时流动；
- **Drawer 详情**：点击卡片右侧滑出，完整内部时间线（Grep ✓ 0.8s / Bash ✓ 1.0s）；
- 测试：`turn-segment-views.test.tsx` 95 用例（含新增卡片流动条 2 用例、纯展示改写）+
  `session-panel-dialog-subagent-drawer.test.tsx` 1 用例 + `session-panel-mobile-subagent` 3 +
  `session-panel-dialog` 63 + `agent-replay-body` 16 + `subagent-detail-panel` 全绿；
- lint / typecheck 通过（dialog 文件两个 warning 为存量）。
