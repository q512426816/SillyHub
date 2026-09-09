---
id: task-03
title: 'sessions-portal.tsx 接线——leftMode/filesModeWorkspaceId(进模式快照)/filePreview({workspaceId,path})/selectedWorkspaceId（六写入点：onSelect/onSelectGroup/handleGroupCreated/深链 getAgentSession/enterPreSession/清选中）状态；fileWorkspaceId=scope 恒 scope.workspaceId 否则 selectedWorkspaceId，null 置灰+title；grid→flex 三栏 + PanelResizer 两把；headerExtra 注入「📁」（data-testid=sessions-left-files-toggle）；点文件 setFilePreview、✕ 清空（data-testid=sessions-file-preview-close）；sessions-portal.test.tsx 新增 describe（mock @/components/explorer/*：切换/返回、置灰+title、选中会话与群可切、深链恢复翻转、开列/关列、切回会话预览保留）'
title_zh: 'sessions-portal.tsx 接线——leftMode/filesModeWorkspaceId(进模式快照)/filePreview({workspaceId,path})/selectedWorkspaceId（六写入点：onSelect/onSelectGroup/handleGroupCreated/深链 getAgentSession/enterPreSession/清选中）状态；fileWorkspaceId=scope 恒 scope.workspaceId 否则 selectedWorkspaceId，null 置灰+title；grid→flex 三栏 + PanelResizer 两把；headerExtra 注入「📁」（data-testid=sessions-left-files-toggle）；点文件 setFilePreview、✕ 清空（data-testid=sessions-file-preview-close）；sessions-portal.test.tsx 新增 describe（mock @/components/explorer/*：切换/返回、置灰+title、选中会话与群可切、深链恢复翻转、开列/关列、切回会话预览保留）'
author: 'qinyi'
created_at: 2026-09-09 00:39:03
priority: P0
depends_on: [task-01, task-02]
blocks: [task-04]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001, D-002, D-003, D-004, D-005, D-006]
allowed_paths:
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
target_files:
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
goal: >
  在 sessions-portal.tsx 落地会话页三分屏接线与左栏二模状态机——leftMode /
  selectedWorkspaceId（六写入点快照，D-006）/ filesModeWorkspaceId（进模式快照）/
  filePreview({workspaceId, path}) 独立预览列四组 state、fileWorkspaceId 解析与
  置灰、grid→flex 三栏 + 两把 PanelResizer、headerExtra 注入「📁」切换钮——让
  用户不离开会话上下文即可浏览工作区文件（design §5.A–§5.D / FR-01~FR-04，
  Wave 2 核心，消费 task-01 两壳组件与 task-02 插槽）。
expects_from:
  task-01:
    - contract: PortalFileTreePanelProps / PortalFilePreviewPanelProps + 宽度常量
      needs: [workspaceId, onBack, onSelectFile, filePath, onClose, SESSIONS_LEFT_PANEL_WIDTH_LS_KEY, SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY]
  task-02:
    - contract: SessionListPanel headerExtra 可选插槽
      needs: [headerExtra]
implementation:
  - '状态与解析（design §5.B/§5.C）——新增四 state：leftMode（"sessions"|"files"，初始 sessions）、filesModeWorkspaceId（进文件模式时快照、返回会话清）、filePreview（{workspaceId, path} | null）、selectedWorkspaceId（string | null）；fileWorkspaceId 用 useMemo——scopedWorkspaceId 非空（workspace/change/quicklog，复用 295-298 行既有派生）恒 scope.workspaceId，否则取 selectedWorkspaceId'
  - '六写入点快照 selectedWorkspaceId（design §5.B 表 / D-006）——onSelect（546-555 行）加 setSelectedWorkspaceId(s.workspace_id)（行对象直取非列表查找）；handleSelectGroup（484 行）/handleGroupCreated（499 行）加 group.workspace_id（必填）；深链 effect（157-176 行）getAgentSession .then 内按返回体 session.workspace_id 写入（session_kind 会话/群两分支共用）；enterPreSession（327 行）按合成后 preContext.workspaceId 写入（可 null=非工作区组）；清选中路径（onDeleteSessions/onArchiveSessions/onUnarchiveSessions 选中被删时、onArchiveGroup/onUnarchiveGroup/onDeleteGroup 选中群被操作时）统一置 null'
  - 'headerExtra 注入（design §5.C / D-002）——SessionListPanel 传 headerExtra=「📁」切换按钮（aria-label「查看工作区文件」、data-testid=sessions-left-files-toggle）；fileWorkspaceId 为 null 时 disabled 且 title=「请先选择一个会话，再查看其所属工作区的文件」；点击时 setFilesModeWorkspaceId(fileWorkspaceId) + setLeftMode("files")'
  - 'grid→flex 三栏布局（design §5.A）——542 行 grid-cols-[320px_minmax(0,1fr)] 换 flex（保留 gap-3/min-h-0/flex-1）；左栏 div style.width=leftWidth 且 shrink-0 二模渲染（sessions=SessionListPanel 含 headerExtra；files=PortalFileTreePanel({workspaceId=filesModeWorkspaceId, onBack, onSelectFile})，D-003 卸载 SessionListPanel）+ 左把手 PanelResizer（usePanelWidth storageKey=SESSIONS_LEFT_PANEL_WIDTH_LS_KEY 默认 320/min 240/max 560，aria「调整会话列表宽度」）；中栏 flex-1 min-w-0 既有四分支（群/会话/预会话/空态）原样迁入（R-01）；filePreview 非空时追加右把手（SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY 默认 480/min 320/max 860，aria「调整文件预览宽度」）+ 右列 div style.width=previewWidth、data-testid=sessions-file-preview-column 内挂 PortalFilePreviewPanel（onClose 清 filePreview），把手随列一并卸载'
  - '交互细节（design §5.D）——onSelectFile 回调 setFilePreview({workspaceId=filesModeWorkspaceId, path})（同文件重复点幂等）；「✕」（data-testid=sessions-file-preview-close，壳组件承载）清空整列含把手；「← 返回会话」仅清 filesModeWorkspaceId 快照、filePreview 保留；files 模式中切换选中不退出文件模式，重进时树按届时 fileWorkspaceId 重建、旧预览按其 {workspaceId, path} 继续取数不串档（D-004）'
  - '测试（design §6 / R-04）——sessions-portal.test.tsx mock 区新增 vi.mock("@/components/explorer/file-explorer") 与 vi.mock("@/components/explorer/file-preview")（stub 渲染并捕获 props，named 与 default 导出都提供；不 mock @/lib/explorer，取数层归 portal-file-panels.test）；新增 describe（沿用「SessionsPortal <主题>」命名与 renderPortal 惯例）覆盖六组用例——切换/返回（📁→FileExplorer 挂载且 workspaceId 正确、SessionListPanel 卸载、← 返回会话复原）、置灰+title（全局无选中 disabled+title 提示；scope 入口恒可点）、选中会话与群可切（onSelect 的 s.workspace_id / onSelectGroup 的 group.workspace_id 快照）、深链恢复翻转（?session= 经 getAgentSession resolve 后按钮由置灰翻转为可点，含群深链 session_kind=group，R-05）、开列/关列（onSelectFile→FilePreview 收到 {workspaceId, filePath}；✕→列与把手卸载）、切回会话预览保留（返回后预览列仍在；换选中重进文件模式树按新工作区且旧预览不串档）'
acceptance:
  - 'FR-01 左栏二模——「📁」（data-testid=sessions-left-files-toggle）点击进文件模式挂 PortalFileTreePanel 且 SessionListPanel 卸载；「← 返回会话」（sessions-files-back）回会话模式；中栏四分支（群/会话/预会话/空态）渲染与 key 重挂载契约不受切换影响'
  - 'FR-02 六写入点齐全——scope 入口恒 scope.workspaceId；全局 onSelect/onSelectGroup/handleGroupCreated/深链 getAgentSession/enterPreSession/清选中六链路正确写入或置 null；fileWorkspaceId=null 时按钮 disabled 且 title=「请先选择一个会话，再查看其所属工作区的文件」（design §10-2 的组件级断言）'
  - 'FR-03 预览列——点文件 setFilePreview({workspaceId=进模式快照, path}) 同文件幂等；「✕」（sessions-file-preview-close）整列含把手收起；切回会话列表预览列保留；预览按 {workspaceId, path} 独立取数不跨工作区串档（FR-05 语义）'
  - 'FR-04 三栏——flex 布局 + 两把 PanelResizer（左默认 320/240–560、右默认 480/320–860，aria 分别「调整会话列表宽度」「调整文件预览宽度」），中栏 flex-1 min-w-0；宽度经 usePanelWidth 落 localStorage 记忆（design §10-3/§10-4 的组件级断言，浏览器对照归 task-04）'
  - '新增 describe 六组用例全绿且既有 39 用例零回归（design §10-5 前半；tsc/eslint 由 task-04 汇总复核）'
verify:
  - 'pnpm -C frontend exec tsc --noEmit（对照改动前基线 0 新增错误）'
  - 'pnpm -C frontend exec eslint src/components/sessions/sessions-portal.tsx src/components/sessions/__tests__/sessions-portal.test.tsx（0 error 0 warning）'
  - 'pnpm -C frontend exec vitest run src/components/sessions/__tests__/sessions-portal.test.tsx（新增 describe + 既有 39 用例全绿；不跑全量，CLAUDE.md 规则 0）'
constraints:
  - 'UI 文案中文且按需求原句（aria-label「查看工作区文件」/title「请先选择一个会话，再查看其所属工作区的文件」）；样式走 brand-* 语义阶与主题 token，不新引 blue-* 硬编码'
  - '?session= 深链语义不变——会话/群分流、无效静默落空门户态、选中态 URL 同步全部原样，仅追加 selectedWorkspaceId 写入（R-05 验证请求完成前的短暂置灰是暂态非 bug）'
  - '中栏四分支渲染结构与 SessionPanel/GroupChatPanel key 重挂载契约不动（R-01）；SessionListPanel 其余 props 透传不动，headerExtra 之外零改动'
  - '空门户「继续最近会话」快捷动作不在 design §5.B 六写入点内，按 design 不动；如验收发现该路径按钮未翻转，回 design 补写入点而非本卡私加'
  - '测试只 mock @/components/explorer/file-explorer 与 file-preview 两组件（R-04 两层各测各的）；既有 39 用例断言不改（非测试逻辑有误禁止改测试，CLAUDE.md 规则 9）；不跑全量测试'
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
