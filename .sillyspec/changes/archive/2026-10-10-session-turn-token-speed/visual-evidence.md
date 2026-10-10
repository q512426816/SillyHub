# 视觉证据（visual-evidence）— 2026-10-10-session-turn-token-speed

## 改动性质

本变更为**文本级追加**：轮尾既有辅助信息行（`↑输入 ↓输出` token 计数）尾部追加
` · N tok/s` 速度段。零新增组件、零布局改动、零颜色/主题改动（沿用既有
`text-muted-foreground/80` 同色同层级），无视觉降级决策点。

## 渲染验证方式

未起全栈实页截图（实时 tok/s 需 daemon+backend+真实轮收尾数据，成本与该文本级
改动不相称）；以 jsdom 组件级渲染断言代替，覆盖两条轮尾路径：

- `turn-timeline-token-speed.test.tsx`（viewMode="all" → TurnStatusBadge 路径）：
  - 终态轮渲染出 `↓1,250 · 100 tok/s`（1250 tok ÷ 12.5s）；
  - 运行中轮只显示 token 计数、无 tok/s；
  - 缺 apiDurationMs（旧数据）只显示 token 计数、无 tok/s。
- 同文件「对话视图（RoundDivider meta）」用例：conversation 视图 meta 同样
  出现 `↓1,250 · 100 tok/s`。

## 结论

两视图渲染输出与既有 token 计数格式完全同构，仅在末尾追加速度段；格式化口径
（≥10 取整 / <10 一位小数 / 负值钳 0）由 `turn-speed.test.ts` 12 用例覆盖。
无降级、无视觉面收缩，无需用户裁决项。
