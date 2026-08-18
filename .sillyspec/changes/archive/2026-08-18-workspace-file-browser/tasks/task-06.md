---
id: task-06
title: file-explorer-tree-and-search
title_zh: 文件树组件——antd Tree 懒加载 + 文件名搜索 + 祖先链直达
author: qinyi
created_at: 2026-08-18 12:39:45
priority: P0
depends_on: [task-05]
blocks: [task-08]
requirement_ids: [FR-01, FR-04]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/explorer/file-explorer.tsx
  - frontend/src/components/explorer/__tests__/file-explorer.test.tsx
provides:
  - contract: FileExplorer
    fields: [workspaceId, onSelectFile]
expects_from:
  task-05:
    - contract: explorer-lib
      needs: [fetchTree, fetchSearch]
goal: >
  左侧文件树组件（FR-01/FR-04，D-005@v1）——antd Tree loadData 逐层懒加载，顶部文件名全局搜索，搜索结果点击后对祖先链逐层展开直达并选中目标文件。
implementation:
  - props 为 workspaceId 与 onSelectFile(relPath)（文件节点点击回调，供 task-08 页面装配驱动右栏预览）；组件内部自管 treeData/expandedKeys/selectedKeys，antd Tree 受控模式
  - 首层 fetchTree(workspaceId, 空路径) 加载根；loadData 展开节点时 fetchTree 该目录 rel 路径，updateTreeData 递归挂 children（照 remote-folder-picker.tsx 先例），目录 isLeaf 为 false 文件为 true，目录文件分用 lucide 图标，同级目录先于文件再按名排序
  - 树节点 key 用相对根的 POSIX rel 路径；单节点加载失败置空子节点加红条提示不崩溃，空目录与失败可区分
  - 搜索框防抖后调 fetchSearch(workspaceId, q)，结果按相对路径列出；truncated 为 true 时提示仅显示前 100 条（D-005 文件名搜索上限语义）
  - 搜索直达——点击结果后按命中路径自根向下逐层截取祖先段，逐层 await fetchTree 填充 children 并把各级目录 key 累积进 expandedKeys，最后 selectedKeys 选中该文件并触发 onSelectFile；受控 expandedKeys 必须同步更新才能逐层展开
acceptance:
  - 根层加载与逐层展开都调用 fetchTree 且只取当前层，不递归预取整树（design 非目标约束）
  - 搜索结果点击后祖先链逐层展开、目标节点被选中且 onSelectFile 收到正确 rel 路径
  - truncated 提示、空目录、单节点失败降级分支均有测试用例
verify: cd frontend 后 pnpm vitest run explorer，再 pnpm exec tsc --noEmit
constraints:
  - 组件测试落 frontend/src/components/explorer/__tests__/（仓库组件测试目录惯例），vi.mock 掉 lib/explorer 数据层，不真实发请求
  - 懒加载沿用 file-rpc 逐层语义禁递归预取；祖先链直达必须逐层 await fetchTree 走受控 expandedKeys，不得绕过 loadData 语义
  - 视觉遵循设计系统（FRONTEND_PAGE_STYLE.md 惯例、antd 6 加 shadcn 视觉件、中文文案）；不改 workspace-tabs 与页面装配（task-08 负责）
related_tests: file-explorer.test.tsx——懒加载/排序图标/搜索防抖/truncated 提示/祖先链直达选中/失败降级，全 mock explorer-lib
---
