---
id: task-01
title: globals.css 氛围/阴影 token 三主题分值
title_zh: 氛围与阴影 token 三主题分值落地
allowed_paths:
  - frontend/src/app/globals.css
depends_on: []
goal: 落地 FR-02/FR-03/FR-06 的 token 层：新增氛围与玻璃 token，三主题分值写满（D-002@v2）
implementation: |
  1. :root（ai-native 紫系）新增：--border-soft（brand-700 10% 透明）、--row-active（紫→青 90deg 渐变 14%/8%）、--row-active-ring（紫 22%）、--shadow-glow（brand-500 16% 20px）、--glass（白 52%）、--glass-heavy（白 78%）、--aurora-1/2/4（v4 原型 :root 段取值）；--shadow-primary 降重为 v4 口径（0 1px 3px .16 + 0 8px 20px -10px .28）。
  2. [data-theme="blue"] 块补齐同键蓝系取值（#2563eb 系极光/选中环/投影，零紫色成分）。
  3. [data-theme="dark"] 块补齐青系取值（v4 原型 dark 段：aurora 17%/22%/16%、row-active 18%/10%、ring 30%、glass rgba(14,14,18,.55)/.80）；--color-bg #18181b→#09090b、--background HSL 等值 240 10% 3.9%（zinc-950）。
  4. 行尾注释标注 ql 口径来源（D-002@v2 三主题分值 / D-009@v1 降重）。
acceptance: globals.css 三块（:root/blue/dark）均含全部新 token 且品牌色系各归各色；dark --color-bg=#09090b；无组件侧硬编码 hex 新增
verify: pnpm -C frontend exec tsc --noEmit 通过；grep globals.css 确认 blue 块无 124,58,237（紫）残留
constraints:
  - 取值遵循 v4 原型变量段；dark 色阶限 Tailwind v3 默认值
  - 不删除任何既有 token/规则，只新增与降重 shadow-primary
---

## 说明

token 层是后续所有 Wave 的取值单一源，本卡先行。
