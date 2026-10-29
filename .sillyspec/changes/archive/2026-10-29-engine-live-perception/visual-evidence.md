# 视觉证据 — 2026-10-29-engine-live-perception

## 原型产物（real-code 管线）

- 源：`frontend/src/components/prototype/engine-live-perception-view.tsx`（真码方言：
  Tailwind token 零硬编码色；等待条目 DOM 结构与文案对齐生产 turn-live-marquee.tsx
  胶囊——管线独立编译仅相对导入 + react，生产组件经 @/ alias 不可拉入，按管线规约
  「DOM 结构对齐生产」本地复刻；生产组件行为由测试钉板）
- 构建：`pnpm prototype:build` 产物 `frontend/prototype-dist/engine-live-perception.html`
  （六区块：现状对照/等待首字/生成·估算/生成·权威/慢提示/过期回落）
- 变更目录复件：`prototype-engine-live-perception.html`（167,770 字节，可双击打开）
- 生产组件行为锚：`frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx`
  「等待三态与估算补显（FR-03）」7 用例——三态文案逐字断言（含「约 12,000 token」/
  权威不带约/慢提示/过期回落/↑↓ 并存），50 用例全绿

## 验证方式

组件级断言承载（三态文案/口径由测试逐字钉板）；原型 html 为区块级可视对照（本地
打开核对六形态与生产 DOM 结构一致性）。无页面级重做（跑马灯胶囊内信息增强），
无对比稿需求。

## 用户裁决记录

无降级项——三态文案与口径均来自用户裁决（C 口径：估算标约/权威不带约/不冒充）
与批准的 design；原型图标位以 ✦ 代位（lucide 独立编译限制，生产组件为 Sparkles，
非视觉降级——形态级差异仅图标字形）。
