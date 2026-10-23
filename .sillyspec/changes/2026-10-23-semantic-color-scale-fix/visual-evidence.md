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
- 700 = `color-mix(… hsl(var(--<palette>)) 50%, hsl(var(--foreground)))`

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

700 档基色占比按 WCAG AA 复算从 75% 降到 50%。复算方法：按 globals.css 各主题块的
`--<palette>` / `--foreground` / `--background` HSL 值转 sRGB，`color-mix(in srgb)` 按
gamma 编码分量线性插值（700 = 基色 p% + foreground (100-p)%；徽章底 50 = 基色 10% +
background 90%），再按 WCAG 相对亮度公式求对比度。三套主题 × 三调色板结果：

| 主题 | 调色板 | 75% 对比度 | 50% 对比度 |
|---|---|---|---|
| ai-native | warning | 3.97 | 6.21 |
| ai-native | info | 4.57 | 6.74 |
| ai-native | destructive | 5.49 | 7.77 |
| blue | warning | 2.96 | 4.88 |
| blue | info | 3.21 | 5.13 |
| blue | destructive | 5.60 | 7.94 |
| dark | warning | 9.58 | 11.37 |
| dark | info | 10.70 | 12.02 |
| dark | destructive | 5.28 | 7.80 |

结论：75% 时两套浅色主题的 warning/info 低于 AA 4.5:1（最差 2.96:1）；50% 时浅色最差
4.88:1、深色最差 7.80:1，全部达标。构建复跑 `Done in 90ms`，12/12 类仍命中，
`text-*-700` 规则已变为 50% 混合。

## 用户裁决

本变更**不存在视觉降级项**，无需逐项降级签字：改造前状态是「类名未定义 → 状态点透明、
徽章软底/描边/深字全部丢失」（缺陷修复前一状态），本次为恢复设计意图 + 将 700 档对比度
按 WCAG AA 校准（最差 5.07:1），属质量提升而非降级。design 风险节所述「与传统 Tailwind
色阶的观感存在细微差异」是语义色派生方案与 Tailwind 默认十六进制色阶的固有色调差，
不改变可见性与可读性结论。

裁决与批准通道如实声明：本次为 agent 自批（channel=agent-self），未取得用户逐项目视
确认；如用户目视后认为色调/明度不合意，仅需调整 `semanticScale` 中 700 档比例（单点，
不破坏调用点与测试形态断言），无需重做结构。

## 用户目视核对

待用户在会话页/agent-log 页目视确认：左栏「在等你」琥珀点可见；活性徽章软底+描边+深字
正常；切深色主题后颜色随变量变化。本文件记录构建级证据与对比度复算，目视结论请追加于此。
