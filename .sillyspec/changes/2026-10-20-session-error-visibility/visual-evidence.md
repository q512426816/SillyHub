# 视觉证据 — 2026-10-20-session-error-visibility

## 对照基准与复现方法

- 复现对象：生产会话 71419980-07bd-4ad4-b5d9-b1f3130b2ba0（用户报告的 codex 秒死会话；run 7d1ee3e7，error_code=interactive_interrupted，error_detail.raw="codex exited code=1"）。
- 方法：本地 `pnpm build` 构建产物（含修复）+ `next start`（3010）+ 轻量代理（3011，/api/* 转发生产 crrcdt.ppdmq.top 并注入真实 admin token），playwright 打开 `/sessions?session=71419980`。脚本：`.tmp/verify-via-proxy.mjs`（临时件，不入库）。
- 截图：`.tmp/session-page-fixed.png`（修复后）。修复前基线：`.tmp/session-page.png`（同一会话打生产旧镜像实测，playwright 直连生产）。

## 修复前（生产旧镜像，2026-10-20 实测）

- `error-card count: 0`——错误卡零渲染。
- 页面仅显示：会话已结束横幅 + 「你好」用户气泡 + 「第 1 轮 · ✕ 已中止」轮次标记。
- 真实错误（codex exited code=1）完全不可见。

## 修复后（本地构建产物 + 生产真实数据）

- `error-card count: 1`——红色错误卡渲染（RunErrorItem）。
- 卡片内容实测（DOM 断言 + 视觉双重确认）：
  - 标题「运行失败」+ 徽标「运行失败 · unknown」
  - **raw 首行摘要「codex exited code=1」默认可见**（data-testid=run-error-raw-summary，无需任何点击）
  - hint 建议 + 「重新发送」（primary）/「切换供应商」按钮
- 视觉确认：红色左边条警示卡直接展示 `codex exited code=1`（见截图）。

## 真打断对照（FR-03）

- 单测覆盖（page-helpers-error-visibility.test.ts）：error_detail=null 的 interactive_interrupted → status=killed 且 errorDetail=null（零回归，3 个用例）。
- 组件级：RunErrorItem 不渲染（errorDetail null → turn-timeline 不挂错误卡）。

## 视觉降级裁决

无降级。实施与 design 一致。
