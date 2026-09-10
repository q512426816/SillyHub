---
id: task-11
title: '前端——api 层 + 页面框架'
title_zh: '前端——api 层 + 页面框架'
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001, D-009]
allowed_paths:
  - frontend/src/app/(dashboard)/settings/mcp/
  - frontend/src/components/mcp-registry/
  - frontend/src/lib/api/mcp-registry.ts
  - frontend/src/lib/query-keys.ts
  - frontend/src/lib/menu-permissions.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
target_files:
  - frontend/src/app/(dashboard)/settings/mcp/page.tsx
  - frontend/src/app/(dashboard)/settings/mcp/page.test.tsx
  - frontend/src/lib/menu-permissions.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - NEW:frontend/src/lib/api/mcp-registry.ts
  - NEW:frontend/src/components/mcp-registry/server-card.tsx
  - NEW:frontend/src/components/mcp-registry/server-form-modal.tsx
provides:
  - contract: mcp_registry_page_frame
    fields: [tabs_platform_mine, toolbar_search_tag, server_card, binding_switch, mcp_registry_api_client]
expects_from:
  task-03:
    - contract: McpServerList
      needs: [id, name, server_type, server_config, tags, enabled, bindings]
related_tests:
  - frontend/src/app/(dashboard)/settings/mcp/page.test.tsx（既有 7 用例 mock 旧 mcp-settings hooks 并断言 JSON 编辑器形态，页面重构为双 tab 卡片后全部失效，随本卡重写）
goal: >
  从 task-03 落地的 /api/mcp-servers* 端点生成前端类型并新建 mcp-registry api 客户端，
  把 settings/mcp 页从「JSON 编辑器」重构为「平台共享库/我的库双 tab 卡片管理页」
  （搜索标签 + binding 开关 + 新建编辑弹窗），前端落地 D-001 双层可见性与 FR-03 启用绑定。
implementation:
  - node_modules 健康自检（pnpm exec tsc --version）后跑 pnpm gen:types，提交生成的 api-types.ts + backend/openapi.json（CLAUDE.md 规则 21，禁手写 DTO）
  - 新建 frontend/src/lib/api/mcp-registry.ts（范式对齐 lib/api/llm-providers.ts）：列表（scope/search/tag 查询）、详情、创建、更新、删除、binding 加解绑的 fetch 与 React Query hooks；query-keys.ts 增 mcpRegistry 键组
  - page.tsx 重构为 PageHeader「MCP 资产库」+ 双 tab（平台共享库/我的库）+ 工具栏（搜索框/标签筛选/新建按钮）+ 卡片网格；NEW components/mcp-registry/server-card.tsx（stdio 徽标、平台默认/我的私有归属徽标、cmd 行、标签、加密密钥数提示、「对我启用」开关、编辑/复制/存模板/删除操作）
  - binding 开关调 bindings 加解绑端点（FR-03）；admin 平台库可写、普通用户平台库只读；NEW components/mcp-registry/server-form-modal.tsx 照原型⑤（env 键值表 + token/key/secret/password 键名「将加密」pill，R-05 前端明示）
  - menu-permissions.ts menuKey=mcp 的 menuLabel 改「MCP 资产库」（URL /settings/mcp 不变，app-shell 图标映射无需改）；白名单编辑卡片保留页尾不动（D-007 治理层留 settings）
  - 重写 page.test.tsx：旧 7 用例全部失效删除，按新页面写用例（双 tab 渲染、搜索过滤、binding 开关调 mutation、非 admin 平台库只读、新建弹窗 secret 标识、白名单不回归）
acceptance:
  - api-types.ts 与 backend/openapi.json 含 McpServer* 生成类型并随卡提交，前端无手写重复 DTO
  - 平台共享库/我的库双 tab 渲染卡片，scope 切换与搜索/标签筛选生效
  - 「对我启用」开关触发 bindings 端点并更新列表；非 admin 平台库卡片无编辑入口
  - 新建弹窗保存调 POST /api/mcp-servers 且 env secret 键名显示「将加密」标识
  - 侧栏菜单显示「MCP 资产库」且 URL 仍为 /settings/mcp，白名单编辑器功能不回归
  - 重写后的 page.test.tsx 全绿
verify:
  - cd frontend && pnpm exec tsc --version（gen:types 前置 node_modules 健康检查）
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm vitest run "src/app/(dashboard)/settings/mcp/page.test.tsx" src/components/mcp-registry
  - cd frontend && pnpm typecheck && pnpm lint
constraints:
  - 样式照 FRONTEND_PAGE_STYLE.md §1 骨架与 §0.5 主题铁律（brand-* 语义阶、antd 组件色走 ConfigProvider token 不手写 hex、状态 Badge/分类 Tag）
  - 本卡不做三导入入口与诊断面板（task-12）、不动 mcp-settings.ts 旧 config 客户端（task-13 删）、不碰后端与 daemon
  - 跨用户私有库后端 404 防枚举，前端仅按 scope=platform/mine 拉取，不请求他人私有数据
  - 卡片/弹窗交互照原型③⑤区块（prototype-mcp-central-registry.html）
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
