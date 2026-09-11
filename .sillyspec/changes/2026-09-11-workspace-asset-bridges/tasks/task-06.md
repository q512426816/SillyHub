---
id: task-06
title: 'workspace mcp page registry import dialog and gen:types for both repos'
title_zh: 'workspace mcp 页选入弹窗+gen:types 联动'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 21:39:17
priority: P1
depends_on: ['task-02', 'task-05']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-004@v1, D-009@v1, D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp/
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
target_files:
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
expects_from:
  - task-02 提供 POST /api/workspaces/{id}/mcp/import-from-registry 端点契约（响应含写入结果、warning 可选、同名改名后最终 server 名）
  - task-05 提供 workspace skills 页区块与过渡类型命名已合入（gen:types 一次收口两批 schema 变更）
goal: >
  workspace mcp 页增「从资产库选入」弹窗（registry visible 列表+import 调用），并跑双仓 gen:types 把 task-01/02/03/05 累计的后端 schema 变更收口到三件生成物（FR-04 桥③前端面）。
implementation:
  - page.tsx 增「从资产库选入」按钮与弹窗——列表复用 lib/api/mcp-registry.ts 既有可见列表请求（scope 取 visible，只读复用不改该文件）；选中后调用 POST /api/workspaces/{id}/mcp/import-from-registry（请求函数放本页目录，响应类型引用生成物 components schemas）；同名改名与 warning 在结果反馈呈现，成功后刷新 .mcp.json 编辑区
  - 双仓 gen:types——frontend 与 sillyhub-daemon 各跑 pnpm gen:types（先确认前端 node_modules 健康），提交两份 api-types.ts 与 backend/openapi.json，并核对 task-05 过渡类型字段命名一致
  - 测试——page.test.tsx 补弹窗渲染/列表加载/选入调用/改名与 warning 反馈/解密失败 422 中文提示
acceptance:
  - 弹窗列可见 server，选入后 .mcp.json 出现该 server（同名带 -registry 后缀），既有条目不动；成功后编辑区数据刷新
  - 解密失败 422 与停用 warning 均有中文反馈；pnpm tsc 零错误；gen:types 零漂移（双仓 gen:types:check 通过，三件生成物与后端 schema 一致）
verify:
  - cd frontend && pnpm exec tsc --noEmit && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/mcp"
  - cd frontend && pnpm gen:types:check
  - cd sillyhub-daemon && pnpm gen:types:check
constraints:
  - 不手写 api-types.ts（仅生成器产出）；不改 lib/api/mcp-registry.ts（只读复用）；不重构 task-05 的 skills-library 接口层文件
  - UI 中文文案；主题 token 规范同 task-05
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
