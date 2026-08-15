---
id: task-15
title: 前端 CtxUsageBar：上下文用量环 + 供应商额度胶囊（覆盖 FR-08, D-009@v1, D-014@v1）
title_zh: 上下文用量与额度展示组件
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P1
depends_on: [task-07, task-16]
blocks: [task-10]
requirement_ids: [FR-08]
decision_ids: [D-009@v1, D-014@v1]
allowed_paths:
  - frontend/src/components/sessions/ctx-usage-bar.tsx
  - frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
  - frontend/src/lib/api/llm-providers.ts
provides:
  - contract: CtxUsageBar
    fields: [ctxRing, quotaPill]
expects_from:
  task-07:
    - contract: LlmProviderQuotaResponse
      needs: [quota]
goal: >
  输入框上方一行组件：上下文用量环形进度（分母降级链）+ 当前供应商额度胶囊（有则显示），并对齐原型视觉。
implementation:
  - CtxUsageRing：SSE/attach 历史 usage 累计；分母=供应商 model_role_mappings 对应 role 的 one_m 为真取 1000k，否则常量表 200k，再否则只显示累计 token
  - 阈值变色（50% 黄 80% 红）与点击详情浮层（占比+已用/总量）
  - QuotaPill：lib/api/llm-providers.ts 加 getProviderQuota 调 task-07 端点；quota 为 null 或本机默认供应商时不显示胶囊，其余供应商显示灰字提示
  - 胶囊内容为模型名+各窗口剩余+重置时间，低剩余变色（50% 黄 20% 红）
  - 切换供应商后胶囊数据跟随刷新
acceptance:
  - 用量环比率随轮次增长刷新并按阈值变色
  - GLM 供应商显示胶囊、非 GLM 与本机默认不显示
  - 分母三级降级链逐级生效
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - quota 请求失败静默降级（不显示胶囊不报错）
  - 组件自治可独立测试（页面组装归 task-10）
related_tests: []
---
