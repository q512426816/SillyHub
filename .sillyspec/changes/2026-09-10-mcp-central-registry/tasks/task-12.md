---
id: task-12
title: '前端——导入入口 + 诊断面板'
title_zh: '前端——导入入口 + 诊断面板'
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P1
depends_on: ['task-11', 'task-08', 'task-09', 'task-10']
blocks: []
requirement_ids: [FR-06, FR-07, FR-08, FR-09]
decision_ids: [D-001, D-009]
allowed_paths:
  - frontend/src/app/(dashboard)/settings/mcp/
  - frontend/src/components/mcp-registry/
  - NEW:frontend/src/lib/api/mcp-registry.ts
target_files:
  - frontend/src/app/(dashboard)/settings/mcp/page.tsx
  - NEW:frontend/src/lib/api/mcp-registry.ts
  - NEW:frontend/src/components/mcp-registry/import-json-modal.tsx
  - NEW:frontend/src/components/mcp-registry/workspace-scan-modal.tsx
  - NEW:frontend/src/components/mcp-registry/template-panel.tsx
  - NEW:frontend/src/components/mcp-registry/diagnostics-panel.tsx
expects_from:
  task-11:
    - contract: mcp_registry_page_frame
      needs: [tabs_platform_mine, toolbar_search_tag, server_card, binding_switch, mcp_registry_api_client]
  task-08:
    - contract: McpImportJsonResponse
      needs: [imported, skipped, renamed]
  task-09:
    - contract: McpWorkspaceScanCandidate
      needs: [name, workspace_id, verdict, renamed_name]
  task-10:
    - contract: McpTemplateList
      needs: [id, name, server_config, is_preset]
goal: >
  在 task-11 页面框架上补齐三个导入入口（JSON 粘贴 / workspace 扫描 / 模板）与
  注入诊断五项面板（照原型④⑤），六项能力（D-004）的前端收口，FR-06~FR-09 落地。
implementation:
  - mcp-registry.ts 客户端扩展 import-json / workspace-scan / workspace-import-apply / templates 列表与存为模板 / diagnostics 五组端点的 fetch 与 hooks（消费 task-08/09/10 契约）
  - JSON 粘贴导入弹窗照原型⑤：textarea + 目标库（scope）选择，提交后展示 imported/skipped/renamed 三计数结果（FR-06）
  - workspace 扫描弹窗照原型⑤：候选列表（来源 workspace + 三色判定 导入/跳过同名同配置/改名同名异配置）+ 勾选 + 「导入所选」apply 后刷新列表（FR-07）
  - 模板入口：工具栏「从模板新建」+ 模板 tab（预置/自存列表，is_preset 区分），点模板预填 task-11 新建弹窗，卡片「存为模板」操作（FR-09）
  - 诊断面板照原型④：PageHeader「注入诊断」按钮带计数徽标，展开五项分级列表（遮蔽/白名单/解密/死角/类型），调 GET /api/mcp-servers/diagnostics（FR-08，D-011 后端预检前端只展示）
  - page.test.tsx 与组件测试补用例：三弹窗渲染与提交调用、三色判定展示、模板预填、诊断五项展示
acceptance:
  - JSON 粘贴导入按 scope 提交并展示三计数结果摘要
  - 扫描弹窗展示候选与三色去重判定，勾选 apply 后返回结果并刷新库列表
  - 模板列表区分预置/自存，从模板新建预填表单，存为模板后列表刷新
  - 诊断面板展示五项诊断且按钮徽标计数与结果条数一致
  - 新增组件测试与页面测试全绿
verify:
  - cd frontend && pnpm vitest run "src/app/(dashboard)/settings/mcp/page.test.tsx" src/components/mcp-registry
  - cd frontend && pnpm typecheck && pnpm lint
constraints:
  - 诊断语义以 GET /api/mcp-servers/diagnostics 返回为准（D-011 backend 渲染预检），前端不自行推断诊断项
  - 弹窗/面板用 antd Modal/Drawer + FRONTEND_PAGE_STYLE.md §0.5 主题 token，不引入新样式体系
  - 只扩展 task-11 的 api 客户端与页面挂载点，不改既有函数签名与页面骨架；不碰后端与 daemon
  - 交互照原型④⑤区块（prototype-mcp-central-registry.html），文案与判定色（绿导入/灰跳过/黄改名）对齐原型
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
