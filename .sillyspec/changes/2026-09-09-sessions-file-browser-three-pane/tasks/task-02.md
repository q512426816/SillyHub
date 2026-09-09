---
id: task-02
title: 'session-list-panel.tsx 加 headerExtra?: ReactNode 可选 prop（头部「共 N 个」右侧 shrink-0 插槽；未传不渲染，其它消费点零变化）'
title_zh: 'session-list-panel.tsx 加 headerExtra?: ReactNode 可选 prop（头部「共 N 个」右侧 shrink-0 插槽；未传不渲染，其它消费点零变化）'
author: 'qinyi'
created_at: 2026-09-09 00:39:03
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: [D-002]
allowed_paths:
  - frontend/src/components/sessions/session-list-panel.tsx
target_files:
  - frontend/src/components/sessions/session-list-panel.tsx
provides:
  - contract: SessionListPanel headerExtra 可选插槽
    fields: [headerExtra]
related_tests:
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
goal: >
  给 SessionListPanel 加可选 headerExtra?: ReactNode 插槽（头部「共 N 个」右侧 shrink-0 渲染），为 task-03 注入「📁」文件模式切换按钮留口——插槽式扩展（D-002：贴视线焦点且不侵入既有 props）保证其它消费点零变化。
implementation:
  - 'session-list-panel.tsx 的 react 导入行（:100，当前仅 useEffect/useMemo/useRef/useState）补 type ReactNode'
  - 'SessionListPanelProps（:390 起）加可选 prop（design §7 逐字）：headerExtra?: ReactNode——注释注明「头部『共 N 个』右侧插槽（portal 文件模式切换按钮，task-03 注入）；未传不渲染，纯透传零行为变化」'
  - 'WorkspaceTreeList 解构参数表（:673-691）补 headerExtra；头部（:1553-1558）右侧改为 flex 组：现有「共 N 个」span 样式不动，外包 <div className="flex shrink-0 items-center gap-1.5">，headerExtra != null 时渲染在其右侧（条件渲染，不残留空节点；shrink-0 防长内容挤压计数徽章）'
  - '确认 SessionListPanel → <WorkspaceTreeList {...props} /> 透传链（:606-611）无需改动——props 展开自动携带新可选 prop'
acceptance:
  - '未传 headerExtra：头部渲染与现状等价（「会话」标题 + 「共 N 个」徽章原样），session-list-panel.test.tsx 既有用例零改动全绿'
  - '传入 headerExtra：渲染在「共 N 个」右侧同一行且 shrink-0 不被挤掉（该分支的 DOM 断言由 task-03 sessions-portal.test 新增 describe 经 headerExtra 注入覆盖，可复用其既有 session-list-panel importActual props 捕获层）'
  - 'sessions-portal.test.tsx 等全部既有消费点（均未传该 prop）零变化零回归；tsc/eslint 对该文件零新增问题'
verify:
  - 'pnpm -C frontend exec vitest run src/components/sessions/__tests__/session-list-panel.test.tsx src/components/sessions/__tests__/sessions-portal.test.tsx'
  - 'pnpm -C frontend exec tsc --noEmit'
  - 'pnpm -C frontend exec eslint src/components/sessions/session-list-panel.tsx'
constraints:
  - '只加一个可选 prop + 一处头部条件渲染，禁顺手重构头部/筛选区；不改任何既有 props 语义、默认值与渲染行为'
  - '本卡不写新用例（「📁」按钮、aria-label「查看工作区文件」、置灰逻辑全归 task-03）；只跑既有两文件回归'
  - 'UI 文案中文；样式沿用 brand-* 主题阶与 tailwind 惯例（FRONTEND_PAGE_STYLE.md），禁 shadcn 原件'
  - '测试只跑相关两文件，禁全量 vitest（CLAUDE.md 核心规则 0）'
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
