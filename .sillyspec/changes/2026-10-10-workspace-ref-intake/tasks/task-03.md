---
id: task-03
title: 'add-explorer-node-context-menu'
title_zh: 'FileExplorer 树右键与通用右键菜单组件'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 13:48:40
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - frontend/src/components/explorer/file-explorer.tsx
  - frontend/src/components/ui/floating-context-menu.tsx
  - frontend/src/components/explorer/__tests__/file-explorer.test.tsx
target_files:
  - frontend/src/components/explorer/file-explorer.tsx
  - NEW:frontend/src/components/ui/floating-context-menu.tsx
  - frontend/src/components/explorer/__tests__/file-explorer.test.tsx
provides:
  - contract: FileExplorerOnAddNodeRef
    fields: [desc]
expects_from:
  task-01:
    - contract: WsRefDesc
      needs: [kind, workspaceId, path, name, lines]
goal: 新建通用浮动右键菜单组件并在文件树行级右键接入添加文件/目录到会话输入框入口，节点组装为完整 WsRefDesc 回调上层。
implementation:
  - 新建 frontend/src/components/ui/floating-context-menu.tsx 通用组件——受控 open/x/y 与 items 透传渲染，fixed 定位 + document click/contextmenu/scroll 关闭 + 视口 clamp（抽取看板 kanban-task-context-menu.tsx:29-47 先例，通用件注释风格对齐 panel-resizer.tsx）
  - FileExplorer 增可选 prop onAddNodeRef（入参 WsRefDesc）——在 renderTitle 与根节点 title 行元素挂 onContextMenu（frontend/src/components/explorer/file-explorer.tsx:112-141，闭包携带 entry 与 relPath）
  - 菜单单项文案按 kind 区分（添加文件到会话输入框/添加目录到会话输入框），点击组装 desc 回调后关闭——kind 取 file/dir、path 用 keyToPath、name 取条目名或根标题工作区根、workspaceId 取组件 prop
  - 扩展测试——文件/目录/根节点右键出菜单且点击回调 desc 逐字段正确（根节点 path 空串）、document 事件关闭菜单、未传 onAddNodeRef 时右键为浏览器默认菜单
acceptance:
  - 右键文件/目录/根节点出现单项菜单，onAddNodeRef 收到完整 desc（kind/path/name/workspaceId 逐字段正确）
  - document 点击/右键/滚动关闭菜单且监听随关闭或卸载移除；未传回调时树行为与现状一致
verify:
  - cd frontend && pnpm exec vitest run src/components/explorer/__tests__/file-explorer.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 菜单本期单项，不做重命名/删除等树操作扩展；右键不改变树选中与展开语义（选中仍走 onSelect）
  - 品牌色 brand-* 语义阶与主题 token（bg-popover/border-border 阶），文案中文；后端 0 端点
  - 菜单为受控 React 状态，document 级监听随菜单关闭/卸载移除无残留
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
