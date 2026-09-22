---
id: task-01
title: '新建 frontend/src/components/sessions/portal-file-panels.tsx（PortalFileTreePanel：← 返回会话头部 + FileExplorer 直通；PortalFilePreviewPanel：✕ 关闭头部 + FilePreview 直通；导出 SESSIONS_LEFT_PANEL_WIDTH_LS_KEY 默认 320/240–560 与 SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY 默认 480/320–860）+ NEW:__tests__/portal-file-panels.test.tsx（mock @/lib/explorer：两组件渲染、onBack/onClose/onSelectFile 直通、常量断言）'
title_zh: '新建 frontend/src/components/sessions/portal-file-panels.tsx（PortalFileTreePanel：← 返回会话头部 + FileExplorer 直通；PortalFilePreviewPanel：✕ 关闭头部 + FilePreview 直通；导出 SESSIONS_LEFT_PANEL_WIDTH_LS_KEY 默认 320/240–560 与 SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY 默认 480/320–860）+ NEW:__tests__/portal-file-panels.test.tsx（mock @/lib/explorer：两组件渲染、onBack/onClose/onSelectFile 直通、常量断言）'
author: 'qinyi'
created_at: 2026-09-09 00:39:03
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-03, FR-04, FR-05]
decision_ids: [D-001, D-004, D-005]
allowed_paths:
  - NEW:frontend/src/components/sessions/portal-file-panels.tsx
  - NEW:frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx
target_files:
  - NEW:frontend/src/components/sessions/portal-file-panels.tsx
  - NEW:frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx
provides:
  - contract: PortalFileTreePanelProps / PortalFilePreviewPanelProps + 宽度常量
    fields: [workspaceId, onBack, onSelectFile, filePath, onClose, SESSIONS_LEFT_PANEL_WIDTH_LS_KEY, SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY]
related_tests:
  - frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx
goal: >
  新建文件模式两壳组件 portal-file-panels.tsx（PortalFileTreePanel：← 返回会话头部 + FileExplorer 直通；PortalFilePreviewPanel：✕ 关闭头部 + FilePreview 直通；两栏宽度常量）及配套单测，为 task-03 三分屏接线提供纯组合薄壳——D-001 零 explorer 新逻辑，四端链路原样复用。
implementation:
  - '新建 frontend/src/components/sessions/portal-file-panels.tsx：首行 "use client"（FileExplorer/FilePreview 均为客户端 hook 组件，先例 file-explorer.tsx:1）；文件头注释注明依据（本变更 design §5.C/§7、D-001/D-004/D-005）与覆盖说明'
  - '导出 props 接口（design §7 逐字）：PortalFileTreePanelProps { workspaceId: string; onBack: () => void; onSelectFile: (path: string) => void }；PortalFilePreviewPanelProps { workspaceId: string; filePath: string; onClose: () => void }（filePath 为相对工作区根 POSIX 路径）'
  - 'PortalFileTreePanel：外层容器与 SessionListPanel 左栏同款（flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card，session-list-panel.tsx:1550）；头部 border-b border-border px-3 py-2（1553 行同款）——antd Button size="small" type="text" + lucide 图标 ArrowLeft 的「← 返回会话」按钮（aria-label=返回会话、data-testid=sessions-files-back、onClick=onBack）+「工作区文件」标题（text-sm font-semibold text-foreground）；主体 <FileExplorer workspaceId={workspaceId} onSelectFile={onSelectFile} /> 直通（props 契约 file-explorer.tsx:54-59，自带搜索/懒加载/错误态/刷新，壳内不加任何包装逻辑）'
  - 'PortalFilePreviewPanel：同款列容器（flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card）；头部——antd Button size="small" type="text" + lucide 图标 X 的「✕」关闭按钮（aria-label=关闭文件预览、data-testid=sessions-file-preview-close、onClick=onClose）+ filePath 文本（text-xs text-muted-foreground truncate，title={filePath} 悬浮看全路径）；主体 <FilePreview workspaceId={workspaceId} filePath={filePath} /> 直通（props 契约 file-preview.tsx:341-346，filePath 形参为 string|null，string 直接可赋；下载/全屏在其内部）'
  - '导出宽度常量（本文件只导出不消费，usePanelWidth/PanelResizer 接线归 task-03）：SESSIONS_LEFT_PANEL_WIDTH_LS_KEY（localStorage key 字符串）+ SESSIONS_LEFT_PANEL_WIDTH_DEFAULT=320 / SESSIONS_LEFT_PANEL_WIDTH_MIN=240 / SESSIONS_LEFT_PANEL_WIDTH_MAX=560；SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY + SESSIONS_FILE_PREVIEW_WIDTH_DEFAULT=480 / SESSIONS_FILE_PREVIEW_WIDTH_MIN=320 / SESSIONS_FILE_PREVIEW_WIDTH_MAX=860'
  - '新建 __tests__/portal-file-panels.test.tsx：文件头注释按 sessions-portal.test.tsx 惯例（依据/覆盖/mock 策略三段）；vi.mock("@/lib/explorer") 整模块 mock——R-04 分层：壳层只 mock 取数（fetchTree 返回 { entries: [{ name, type: "dir"|"file", size, mtime }] }，字段照 api-types ExplorerEntry；useExplorerFile 返回受控 useQuery 形状如 { data, isLoading }），FileExplorer/FilePreview 真实渲染'
  - '测试用例：a) 两组件渲染——「工作区文件」「← 返回会话」文案与文件树容器出现，预览头部 filePath 文本与「✕」按钮出现；b) onBack/onClose 直通——fireEvent.click 点 sessions-files-back / sessions-file-preview-close，断言各自回调被调用；c) onSelectFile 直通——mock fetchTree 根层含文件条目，点文件树行断言 props.onSelectFile 收到相对路径；d) 常量断言——两个 LS key 为字符串、左栏 320/240/560 与右列 480/320/860 数值齐全'
acceptance:
  - 'portal-file-panels.tsx 导出 PortalFileTreePanel / PortalFilePreviewPanel / PortalFileTreePanelProps / PortalFilePreviewPanelProps / SESSIONS_LEFT_PANEL_WIDTH_LS_KEY / SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY（+ DEFAULT/MIN/MAX 数值常量），props 契约与 design §7 逐字一致'
  - '两壳均为纯直通薄壳：除头部（返回/关闭按钮、标题/路径文本）外无任何状态与取数逻辑，workspaceId/onSelectFile/filePath 原样透传给 FileExplorer/FilePreview'
  - '锚点齐全：sessions-files-back（aria-label 返回会话）、sessions-file-preview-close（aria-label 关闭文件预览）；左栏列级锚点 sessions-file-preview-column / sessions-left-files-toggle 归 task-03 portal 装配层；UI 文案全中文'
  - 'portal-file-panels.test.tsx 覆盖两组件渲染、onBack/onClose/onSelectFile 直通、常量数值断言且全绿；tsc/eslint 对两新文件零新增问题'
verify:
  - 'pnpm -C frontend exec vitest run src/components/sessions/__tests__/portal-file-panels.test.tsx'
  - 'pnpm -C frontend exec tsc --noEmit'
  - 'pnpm -C frontend exec eslint src/components/sessions/portal-file-panels.tsx src/components/sessions/__tests__/portal-file-panels.test.tsx'
constraints:
  - 'D-001 纯组合：不写任何 explorer 取数/渲染/下载逻辑，不改 FileExplorer/FilePreview/usePanelWidth 及 lib/explorer——只 import 组合'
  - '本文件不挂 usePanelWidth/PanelResizer（左栏/右列宽度状态与把手接线归 task-03 sessions-portal.tsx），只导出常量；也不做移动端适配（非目标）'
  - '样式遵循 FRONTEND_PAGE_STYLE.md：antd 业务组件（Button）+ tailwind 布局与 brand-* 主题阶，禁用 shadcn 原件；代码兼容 Windows/Linux/macOS'
  - '测试 mock 策略照 R-04：壳层只 mock @/lib/explorer 取数，不 mock FileExplorer/FilePreview 本身（那是 task-03 portal 层的做法），两层不叠真实渲染'
  - '测试只跑本卡新增文件，禁全量 vitest（CLAUDE.md 核心规则 0）'
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
