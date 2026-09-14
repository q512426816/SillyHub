---
id: task-06
title: '前端 compactSession API + 环浮层按钮（caps/空闲/预会话三态）+ 三分型通知 + vitest'
title_zh: '前端 compactSession API + 环浮层按钮（caps/空闲/预会话三态）+ 三分型通知 + vitest'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 11:03:19
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-06, FR-07]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - frontend/src/lib/daemon/sessions.ts
  - frontend/src/components/sessions/ctx-usage-bar.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
target_files:
  - frontend/src/lib/daemon/sessions.ts
  - frontend/src/components/sessions/ctx-usage-bar.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
expects_from:
  task-01:
    - contract: ProviderCaps
      needs: [compact]
  task-02:
    - contract: SessionCompactResponse
      needs: [accepted, provider, run_id, queued, tokens_before, estimated_tokens_after, error]
goal: >
  前端补齐压缩闭环（FR-06/07）：compactSession API 客户端 + 环浮层「压缩上下文」按钮
  （caps 门控/running 禁用/预会话不渲染三态）+ useSessionCompact 三分型成功通知与失败
  error 通知（D-004）；page-only 挂载（plan-review P1-2：dialog 版面板无 ctx 环不改造），
  测试落点 ctx-usage-bar.test.tsx 扩展。
implementation:
  - 'lib/daemon/sessions.ts 加 compactSession(sessionId)——POST /api/daemon/sessions/{sessionId}/compact，请求/响应类型用 task-02 gen:types 产物（SessionCompactRequest/SessionCompactResponse），照同文件既有会话 API 客户端形态'
  - 'ctx-usage-bar.tsx——CtxUsageRingProps 加 onCompact?: () => void / compactDisabled?: boolean / compactTooltip?: string（可选回调先例 :120 onWindowOverrideChange）；Popover（:204-239）编辑器行后插按钮行：提供 onCompact 且 getProviderCaps(provider).compact（:439 caps 门控同源）才渲染，antd Button size="small" 带 data-testid="ctx-compact-button"，disabled=compactDisabled + tooltip 文案（缺省「轮运行中」）；CtxUsageBar 透传三 props'
  - 'session-panel-page.tsx——useSessionCompact mutation 调 compactSession(sessionId)：成功三分型通知（D-004）——tokens_before 有值 →「已压缩：{tokens_before} → 约 {estimated_tokens_after} tokens」/ codex 受理（accepted 无数字）→「已触发上下文压缩」/ claude run_id →「已发送 /compact（压缩轮运行中）」；失败 notify error 带响应 error 原文（如 pi "Nothing to compact"）；正式面板挂 onCompact + compactDisabled=running（:1451 现成派生 turnState.currentRunId != null）+ compactTooltip；预会话 CtxUsageBar（:2722 trailing 插槽）不传 onCompact（无 sessionId 不渲染按钮）'
  - 'page-only：dialog 版面板用 SessionUsageBar 非 CtxUsageBar（plan-review P1-2 核实），本卡不改造 dialog'
  - 'ctx-usage-bar.test.tsx 扩展——caps false（或未传 onCompact）不渲染按钮 / compactDisabled 禁用态 + tooltip / 点击调用 onCompact（渲染与交互断言覆盖三分支）'
acceptance:
  - caps.compact=false 或未提供 onCompact 时按钮不渲染；claude/pi/codex + onCompact 时渲染（antd Button size small + data-testid）
  - running（compactDisabled=true）时按钮禁用；预会话（:2722）不出现按钮
  - 点击触发 compactSession POST；三分型通知按响应分型断言（pi 数字型/codex 受理型/claude 已发送型）；失败通知带响应 error 原文
  - api-types.ts 来自 gen:types 不手写（types 源头为 task-02 产物）；vitest + tsc 绿
verify:
  - pnpm -C frontend exec vitest run src/components/sessions/__tests__/ctx-usage-bar.test.tsx
  - pnpm -C frontend exec tsc --noEmit
constraints:
  - 类型只用 task-02 gen:types 产物（禁手写 api-types）；不改环分子口径与分母链（NG-05）——压缩后环回落靠下一轮 usage 自然到达（零改动）
  - page-only：dialog 版面板不挂按钮；不动 compact_boundary/compaction 事件透传（NG-04）
  - antd 组件色经 ConfigProvider token 不手写（多主题铁律）；按钮文案中文；Windows / Linux / macOS 兼容
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
