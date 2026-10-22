---
author: flow-machine-draft
created_at: 2026-10-22T23:40:11.769Z
---
# 任务注册表（Tasks）— 2026-10-23-semantic-color-scale-fix

- [x] task-01: tailwind.config.ts 新增 `semanticScale` 派生函数并为 warning/info/destructive 补齐 50/200/500/700（500=`hsl(var(--x))`，50/200/700=color-mix），DEFAULT/foreground 原样保留；`tsc --noEmit` 通过
- [ ] task-02: 真实构建验证——tailwind CLI 以项目配置编译含代表类名的探针内容，grep 确认 `bg-warning-500`/`border-warning-200`/`bg-warning-50`/`text-warning-700` + info/destructive 代表类均生成；结论落 visual-evidence.md；确认 liveness-badge.tsx / session-list-panel.tsx 零 diff
- [ ] task-03: 新增 tailwind-semantic-colors.test.ts（三调色板 × 四数字键存在与派生形态 + DEFAULT/foreground 零漂移）；vitest 跑绿
- [ ] task-04: 触及面回归——sessions 组件 + agent-log 组件测试全绿，tsc 零错，assertion-surfaces 绿
