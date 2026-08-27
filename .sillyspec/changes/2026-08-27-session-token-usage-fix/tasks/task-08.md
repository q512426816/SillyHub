---
id: task-08
title: 'frontend ring numerator = latest non-null ctxTokens + unknown state'
title_zh: 'frontend session-panel 环分子改逆序最新非 null ctxTokens + ctx-usage-bar usedTokens 可空与未知态渲染 + 文案更新'
author: 'qinyi'
created_at: 2026-08-27 23:57:01
priority: P0
depends_on: ['task-07']
blocks: ['task-09']
requirement_ids: [FR-01, FR-02]
decision_ids: [D-002@v1, D-003@v1, D-004@v1]
expects_from:
  - 'task-07：api-types SessionRunRead.ctx_tokens + lib/daemon.ts SessionStreamEnvelope.ctx_tokens 类型就绪'
related_tests:
  - frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/sessions/ctx-usage-bar.tsx
goal: >
  环分子由「Σ 各轮 inputTokens」（跨调用可加的计费量当瞬时量，design §1.1 失真根因）
  改为 displayTurns 逆序第一个非 null 的 ctxTokens，usedTokens 改 number | null 并
  渲染未知态（D-003），浮层文案改 last-call 口径（FR-01）。
implementation:
  - turn-timeline.tsx：SessionTurnView 加可选字段 ctxTokens?: number | null（仅类型声明，徽标渲染不动，D-004）
  - session-panel.tsx 两条数据源写 turn.ctxTokens：① onTokens 与 onTurnCompleted 回调（panel 模式 ~:1125 与 dialog 模式 ~:3305/:3343 两套）加 ctxTokens: env.ctx_tokens ?? turn.ctxTokens（null 不覆盖已收值）；② runsMeta 回填（enriched ~:1493 与孤儿 turn ~:1518）加 ctxTokens: t.ctxTokens ?? meta.ctx_tokens ?? null
  - session-panel.tsx usedTokens memo（~:1567）：由 reduce 求和改为逆序第一个非 null ctxTokens（displayTurns 末位向前找），全 null 返回 null；预会话 CtxUsageBar（~:2311）usedTokens={0} 改为 {null}
  - ctx-usage-bar.tsx：CtxUsageRingProps.usedTokens 改 number | null；usedTokens==null → pct=null，环中心 /「已用」分子 / title / aria-label 显示「—」或未知措辞（不显示 0.0%）；usedTokens 非 null 且无分母时保留只显示累计的现状（第三级降级链零回归）
  - ctx-usage-bar.tsx 浮层口径文案（~:123）改为「最近一次模型调用的提示词大小（含缓存命中部分）」，窗口分母说明句保留
acceptance:
  - 多轮 [null, 5000, 3000] 环取 3000；最新轮 null 上一轮非 null 取上一轮；全 null 时环中心显示「—」、不显示 0.0%、不算百分比
  - SSE tokens / turn_completed 事件 env.ctx_tokens 实时写入对应 turn（null 不覆盖）；runsMeta.meta.ctx_tokens 回填历史 turn 与孤儿 turn
  - usedTokens 非 null 且无分母 → 只显示累计 token 不显示百分比（既有降级链行为不变）
  - turn-timeline 每轮徽标（input/output/cache 四维）渲染零变化
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改环视觉 / 布局 / 交互（design NG-05），只动类型 + 渲染分支 + 文案
  - turn-timeline.tsx 仅加 SessionTurnView 可选字段（可选保证既有构造点 / 测试 fixture 不破坏），徽标不动
  - 既有测试失效断言（ctx-usage-bar.test.tsx 浮层口径文案，~:139）修复归 task-09，本卡不改测试
  - 不动 lib/daemon.ts 与 api-types.ts（task-07 已定型）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
