# 视觉/构建证据 — 2026-10-23-semantic-color-scale-fix

## 缘起

上一变更（2026-10-20-session-awaiting-answer-status）评审 P3 留债：左栏「在等你」琥珀点
（`bg-warning-500`）与 agent-log 活性徽章（`info/warning/destructive` 的 50/200/500/700
数字阶）使用未在 `tailwind.config.ts` 定义的类名——Tailwind 静默不生成 CSS，状态点透明、
徽章软底/描边/深字全丢。

## 修法

`frontend/tailwind.config.ts` 新增 `semanticScale(cssVar)` 派生函数，为
`warning`/`info`/`destructive` 各补 50/200/500/700：

- 500 = `hsl(var(--<palette>))`（基色本体）
- 50/200 = `color-mix(… hsl(var(--<palette>)) 10%/35%, hsl(var(--background)))`
- 700 = `color-mix(… hsl(var(--<palette>)) 75%, hsl(var(--foreground)))`

无硬编码 hex；globals.css 三套主题块零改动；调用点零 diff。

## 真实构建验证（非仅配置在场）

命令（仓根 → frontend 目录执行）：

```bash
# 探针内容见 .tmp/tw-probe/probe.html（12 个代表类）
npx tailwindcss -c tailwind.config.ts \
  -i ../.tmp/tw-probe/input.css \
  --content ../.tmp/tw-probe/probe.html \
  -o ../.tmp/tw-probe/out.css
```

结果：`Done in 107ms`，输出 61 行，12/12 代表类命中：

```
OK bg-warning-500      OK border-warning-200   OK bg-warning-50        OK text-warning-700
OK bg-info-500         OK border-info-200      OK bg-info-50           OK text-info-700
OK bg-destructive-500  OK border-destructive-200  OK bg-destructive-50  OK text-destructive-700
```

生成样例（逐字取自 out.css）：

```css
.bg-warning-50 {
  background-color: color-mix(in srgb, hsl(var(--warning)) 10%, hsl(var(--background)))
}
.bg-warning-500 {
  background-color: hsl(var(--warning))
}
.text-warning-700 {
  color: color-mix(in srgb, hsl(var(--warning)) 50%, hsl(var(--foreground)))
}
```

## 对比度复算（评审 P2 清偿）

700 档基色占比按 WCAG AA 复算从 75% 降到 50%（对 bg-50 背景，两套浅色主题 × 三调色板）：

| 主题 | 调色板 | 75% 对比度 | 50% 对比度 |
|---|---|---|---|
| ai-native | warning | 4.24 | 6.63 |
| ai-native | info | 4.88 | 7.19 |
| ai-native | destructive | 5.91 | 8.37 |
| blue | warning | 3.08 | 5.07 |
| blue | info | 3.35 | 5.36 |
| blue | destructive | 5.88 | 8.34 |

结论：75% 时最差 3.08:1（低于 AA 4.5:1）；50% 时最差 5.07:1，全部达标。构建复跑
`Done in 90ms`，12/12 类仍命中，`text-*-700` 规则已变为 50% 混合。

## 用户目视核对

待用户在会话页/agent-log 页目视确认：左栏「在等你」琥珀点可见；活性徽章软底+描边+深字
正常；切深色主题后颜色随变量变化。本文件记录构建级证据，目视结论请追加于此。
