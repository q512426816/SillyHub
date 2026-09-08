---
id: task-02
title: 'TickRail 刻度轨组件+单测——NEW turn-catalog.tsx（刻度渲染/飞出卡/钳制/aria）+ turn-catalog.test.tsx'
title_zh: 'TickRail 刻度轨组件+单测——NEW turn-catalog.tsx（刻度渲染/飞出卡/钳制/aria）+ turn-catalog.test.tsx'
author: 'WhaleFall'
created_at: 2026-09-08 13:44:09
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-02, FR-08]
decision_ids: [D-003@v2, D-007@v1]
allowed_paths:
  - NEW:frontend/src/components/sessions/turn-catalog.tsx
  - NEW:frontend/src/components/sessions/__tests__/turn-catalog.test.tsx
target_files:
  - NEW:frontend/src/components/sessions/turn-catalog.tsx
  - NEW:frontend/src/components/sessions/__tests__/turn-catalog.test.tsx
provides:
  - 'TurnCatalogEntry 类型（frontend/src/components/sessions/turn-catalog.tsx 导出）：key / turnNo / startedAt / status（completed|failed|running|stopped|pending）/ senderName / promptSummary / answerSummary / loaded 八字段；key = realRunId ?? runId，与 data-turn-key 同源'
  - 'TurnCatalog 默认导出组件（props：entries / activeTurnKey / loadingEarlier? / onJump(entry)）：受控纯组件——刻度轨渲染 + hover/focus 飞出卡 + 点击回调，不直接操作聊天区 DOM'
related_tests:
  - NEW:frontend/src/components/sessions/__tests__/turn-catalog.test.tsx
goal: >
  新建 sessions/turn-catalog.tsx 实现 ZCode 式左缘刻度轨（每轮一条 2px 细横杠刻度，
  hover / 键盘 focus 飞出深色摘要卡，点击 onJump 跳转），配套 turn-catalog.test.tsx
  单测——承载本变更目录形态定稿（D-007）与飞出卡信息展示（FR-01/FR-02），目录数据由
  task-03 派生传入，组件本身受控无副作用。
implementation:
  - '新建 turn-catalog.tsx：导出 TurnCatalogEntry 类型与 TurnCatalog 默认导出（文件名 / 导出名沿用 turn-catalog / TurnCatalog 历史一致约定，内部即刻度轨实现，design §5）。'
  - '刻度轨容器：~30px 垂直细条（w-[30px] flex-col items-center gap-[7px] py-2），刻度组垂直居中——上下伪 spacer（flex:1）撑开；刻度超出面板高度时 spacer 收缩回落顶对齐 + 轨内 overflow-y-auto 隐藏滚动条（R-10）。'
  - '每轮一条 button 刻度（w-[14px] h-[2px] rounded-full）：默认 bg-muted-foreground opacity-45；hover / active 放宽 w-[20px] + bg-brand-600；failed bg-destructive/75；running bg-warning animate-pulse；未加载空心（box-shadow inset 0 0 0 1px 描边）。'
  - 'hover 飞出卡：深色反转（bg-foreground text-background，宽 300px、圆角 10px、重投影）绝对定位于轨右侧 40px；内容 = 轮号 + 提问（semibold 2 行钳制）+ 正文摘要（3 行钳制）+ meta（时间 · 状态 · 发送者，10px；未加载尾注「未加载 — 点击加载该轮并定位」）；垂直位置随刻度 offsetTop 居中并钳制面板可视范围上下各 8px（R-09）。'
  - '飞出卡触发 = 刻度 hover 或 focus-visible（键盘可达，共用定位逻辑）；@media (hover:none) 匹配下不挂载（触屏点击直跳）。'
  - '无障碍与联动：刻度 aria-label=「第N轮 · 状态 · 提问摘要（截断）」；active 刻度 aria-current="true"（不用 aria-pressed）；activeTurnKey 变化时在轨内 scrollIntoView({ block: "nearest" })（ref 守卫首次渲染不滚）。'
  - '新建 __tests__/turn-catalog.test.tsx（~10 用例，对齐 design §11）：刻度渲染数量 / 状态类、hover 与 focus-visible 触发飞出卡（内容与垂直钳制）、aria-label / aria-current、未加载空心与 meta 尾注、click 回调携带 entry、hover:none 不挂飞出卡。'
acceptance:
  - 'turn-catalog.tsx 导出 TurnCatalogEntry 类型与 TurnCatalog 默认导出，props 形态与 design §5 一致（entries / activeTurnKey / loadingEarlier / onJump）。'
  - 'entries 每项渲染一条 14×2px 刻度按钮；默认 / failed / running / 未加载空心四态样式类与 §9 规格一致。'
  - 'hover 或键盘 focus-visible 触发深色飞出卡，内容含轮号 + 提问 + 正文摘要 + meta 且垂直钳制在面板 ±8px；触屏（hover:none 匹配）不挂飞出卡。'
  - '点击刻度回调 onJump(entry) 携带完整条目；active 刻度带 aria-current="true" 并自动滚入轨内可视区。'
  - 'cd frontend && pnpm vitest run src/components/sessions 全绿；cd frontend && pnpm exec tsc --noEmit 0 错误。'
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run src/components/sessions
constraints:
  - '受控纯组件（仿 subagent-catalog.tsx 先例，props 进回调出）：不直接操作聊天区 DOM / 滚动，不发起任何网络请求。'
  - '不实现跳转加载链路（task-04）、不做 mobile Drawer 行式列表与页面 / 布局接线（task-05/06）；本任务仅组件 + 单测。'
  - '颜色只用主题语义类（brand-*/destructive/warning/muted-foreground/foreground/background），随 html data-theme 换肤，不硬编码色值。'
  - '刻度条目轻 DOM（无 markdown 渲染、无图片），不引入虚拟化（R-04 卡顿再议）。'
  - 'antd 不用，轻量自绘 tailwind（与 sessions 组件现有风格一致）。'
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
