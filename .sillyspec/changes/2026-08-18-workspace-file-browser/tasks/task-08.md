---
id: task-08
title: explorer page.tsx 页面装配 + workspace-tabs「文件」标签 + 页面级测试（FR-01~06 集成）
title_zh: 文件浏览页装配与集成冒烟
author: qinyi
created_at: 2026-08-18 12:39:45
priority: P0
depends_on: [task-06, task-07]
blocks: [task-09]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - "frontend/src/app/(dashboard)/workspaces/[id]/explorer/page.tsx"
  - "frontend/src/components/workspace-tabs.tsx"
  - "frontend/src/app/(dashboard)/workspaces/[id]/__tests__/explorer-page.test.tsx"
provides: {}
expects_from:
  task-06: { contract: FileExplorer, needs: [workspaceId, onSelectFile] }
  task-07: { contract: FilePreview, needs: [workspaceId, filePath] }
goal: 装配 /workspaces/[id]/explorer 文件页——左树右预览 VSCode 式布局（对齐变更目录原型 prototype-workspace-file-browser.html），页面持有 selectedFile 联动 FileExplorer 与 FilePreview，首屏 tree 请求失败按 ApiError.status 分发三降级中文卡（404 未绑定引导／502 离线／422 版本过旧），workspace-tabs 加「文件」标签，页面级测试覆盖 FR-01~06 集成冒烟。
implementation:
  - page.tsx 为 "use client" 页面，params.id 取 workspaceId；外层沿用 PageContainer/PageHeader/SectionCard 页面惯例（参考 mcp-tokens/page.tsx），内部左右分栏——左树定宽约 w-72 可滚动、右预览 flex-1，border 分隔，两侧各自独立滚动
  - 页面持有 selectedFile（相对路径 string|null）状态，onSelectFile 下发 FileExplorer、filePath 下发 FilePreview，严格按 task-06/07 契约接线，页面不重复实现树/预览逻辑
  - 三降级态按首屏 tree 失败的 ApiError.status 分发——404 未绑定引导卡（含「成员」页绑定指引）、502 离线卡（提示启动 daemon 后刷新）、422 版本过旧卡（提示升级 daemon），其余错误（504/403/网络）走通用错误条；文案对齐原型降级态 ①②③
  - workspace-tabs.tsx 的 TABS 数组新增一项（key=explorer、label=「文件」、path=/explorer），插在 sessions 与 skills 之间（原型 tabbar 顺序），label 中文风格与现有项一致
  - 页面级测试放 workspaces/[id]/__tests__/explorer-page.test.tsx（仓库惯例，参考 page-sync.test.tsx）——mock lib/explorer 封装覆盖装配冒烟（树加载＋选中→预览联动）、三降级卡各自由 404/502/422 触发渲染、「文件」标签存在且 href 指向 explorer
acceptance:
  - 登录后工作区标签栏出现中文「文件」项且位于会话与 Skills 之间，进入 /workspaces/[id]/explorer 标签高亮正确（前缀匹配 isActive）
  - 正常链路冒烟——树逐层展开、选中文件右侧预览联动、搜索命中直达、下载可用（组件契约集成无回归）
  - 三降级卡各自按错误码渲染中文文案不露 500 堆栈；页面级测试通过且 tsc/lint 干净
verify:
  - cd frontend && pnpm vitest run "src/app/(dashboard)/workspaces/[id]/__tests__/explorer-page.test.tsx"
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint
constraints:
  - 路由 /workspaces/[id]/explorer 为新增目录页，不与既有 /files（方案文件页）冲突且不改 /files 任何行为；explorer 留在 workspace layout 的 WorkspaceTabs 内（不进 isStandalone 豁免名单）
  - 三降级判定口径与 backend 错误映射一致——404 未绑定（含绑定行 daemon_id NULL）、502 离线、422 版本过低，前端按 ApiError.status 分发
  - 页面只依赖 task-05 的 lib/explorer.ts 封装与 task-06/07 组件契约，不裸 fetch 端点；日期时间显式 zh-CN（CI locale 坑）；样式对齐 FRONTEND_PAGE_STYLE 与设计系统总纲
related_tests: []
---
