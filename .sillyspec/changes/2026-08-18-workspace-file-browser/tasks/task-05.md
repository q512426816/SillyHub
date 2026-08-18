---
id: task-05
title: gen-types-explorer-deps-and-lib
title_zh: 类型同步 + react-syntax-highlighter 依赖 + lib/explorer.ts fetch 封装
author: qinyi
created_at: 2026-08-18 12:39:45
priority: P0
depends_on: [task-04]
blocks: [task-06, task-07]
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: []
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/src/lib/explorer.ts
provides:
  - contract: explorer-lib
    fields: [fetchTree, fetchFile, fetchDownload, fetchSearch]
expects_from:
  task-04:
    - contract: api-types
      needs: [ExplorerTreeResponse, ExplorerFileResponse, ExplorerSearchResponse]
goal: >
  task-04 四端点落地后同步前端契约——gen:types 产出 api-types.ts 与 openapi.json，引入 react-syntax-highlighter 依赖，新增 lib/explorer.ts 四个 fetch 封装加 TanStack Query hook，作 task-06/07 组件层唯一取数入口。
implementation:
  - 确认 node_modules 健康（pnpm exec tsc --version 能跑，半坏先 pnpm install --force）后 cd frontend 跑 pnpm gen:types，核对 api-types.ts 已含 ExplorerTreeResponse/ExplorerFileResponse/ExplorerSearchResponse 三 schema，openapi.json 同批产出；再 pnpm add react-syntax-highlighter 与 pnpm add -D @types/react-syntax-highlighter，package.json 与 pnpm-lock.yaml 一并入库
  - 新增 frontend/src/lib/explorer.ts——fetchTree/fetchFile/fetchSearch（入参 workspaceId 加 path 或 q）走 apiFetch 相对路径加 query 选项，类型一律引用 api-types 生成 schema 禁手写 DTO；fetchDownload 返 Blob 照 lib/file/api.ts 的 fetchFileBlob 先例（裸 fetch 带 Bearer 加 401 单飞刷新重试一次，失败抛 ApiError，apiFetch 只解析 JSON 不适合二进制）
  - 同文件包 useExplorerTree/useExplorerFile/useExplorerSearch hook，enabled 按需触发（节点展开才拉树、搜索词非空才搜），query key 本文件内定义
acceptance:
  - api-types.ts 含三个 Explorer schema 且与 openapi.json 同批提交（gen:types 产物，非手写）；package.json 新增依赖与 @types/react-syntax-highlighter devDependency 且 lockfile 同步
  - explorer.ts 导出四个 fetch 封装与 hook，类型全部引用 api-types，tsc 零新增错误
verify: cd frontend 后依次 pnpm exec tsc --version 验环境、pnpm gen:types、pnpm exec tsc --noEmit、pnpm lint
constraints:
  - api-types.ts 与 openapi.json 必须由 pnpm gen:types 生成，禁止手写（CLAUDE.md 规则 21）；gen:types 前确认 node_modules 健康，半坏会报假 CSSProperties 类错误
  - 下载请求必须带 Authorization 头经 fetch 取 Blob，不得拼裸 URL 直连（JWT 鉴权裸 URL 401，design R-06）
  - 只改 allowed_paths 五文件，不动 backend 源码与前端组件页面；react-syntax-highlighter 的渲染使用留给 task-07
related_tests: 无独立用例——数据层由 task-06/07 组件测试 vi.mock 该模块覆盖，类型正确性由 tsc --noEmit 把关
---
