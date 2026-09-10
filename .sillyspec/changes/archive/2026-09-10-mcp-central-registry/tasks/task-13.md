---
id: task-13
title: '收尾——旧端点移除 + 旧调用切换 + 文档'
title_zh: '收尾——旧端点移除 + 旧调用切换 + 文档'
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P0
depends_on: ['task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08', 'task-09', 'task-10', 'task-11', 'task-12']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003, D-007]
allowed_paths:
  - backend/app/modules/settings/router.py
  - backend/app/modules/settings/schema.py
  - backend/openapi.json
  - frontend/src/lib/mcp-settings.ts
  - frontend/src/lib/api-types.ts
  - .sillyspec/docs/backend/modules/mcp_registry.md
  - .sillyspec/docs/backend/modules/settings.md
  - .sillyspec/docs/backend/modules/daemon.md
  - .sillyspec/docs/backend/modules/_module-map.yaml
target_files:
  - backend/app/modules/settings/router.py
  - backend/app/modules/settings/schema.py
  - backend/openapi.json
  - frontend/src/lib/mcp-settings.ts
  - frontend/src/lib/api-types.ts
  - NEW:.sillyspec/docs/backend/modules/mcp_registry.md
  - .sillyspec/docs/backend/modules/settings.md
  - .sillyspec/docs/backend/modules/daemon.md
  - .sillyspec/docs/backend/modules/_module-map.yaml
goal: >
  移除废弃的 GET/PUT /api/platform-settings/mcp 两端点与前端旧调用（D-003 零兼容负担），
  并补齐 mcp_registry 模块文档与 module-map 登记（settings/daemon 模块文档同步），变更收口。
implementation:
  - settings/router.py 删除两端点（约 :235-256）及 McpServersSchema 引用（schema.py 同步删该 schema）、仅服务旧端点的 _redact_mcp_env 与 MCP_PLATFORM_DEFAULT_KEY 常量；whitelist 两端点及其依赖的 _read/_write_setting_json 保留（D-007）
  - frontend/src/lib/mcp-settings.ts 删除旧 config 客户端（getMcpConfig/updateMcpConfig/useMcpConfig/useUpdateMcpConfig/mcpConfigSchema/MCP_SECRET_PLACEHOLDER，:60-67 调用将删端点），whitelist 客户端保留；全仓 grep 确认无残留旧端点调用
  - 删端点后跑 pnpm gen:types 联动提交 backend/openapi.json + frontend/src/lib/api-types.ts（CLAUDE.md 规则 21）
  - NEW .sillyspec/docs/backend/modules/mcp_registry.md 模块卡片（三表/端点矩阵/渲染与授权/导入/诊断五项，格式对齐既有模块卡）；settings.md 删旧端点并注明 whitelist 保留；daemon.md 补 mcp/config 换源与 user_id 行为；_module-map.yaml 登记 mcp_registry 模块
acceptance:
  - GET/PUT /api/platform-settings/mcp 返回 404，/api/platform-settings/mcp-whitelist 两端点行为不变
  - 全仓 grep platform-settings/mcp 仅剩 whitelist 路径命中与文档描述，无代码调用残留
  - openapi.json 与 api-types.ts 无旧端点痕迹且均为生成物
  - mcp_registry.md 存在并进 _module-map.yaml，settings/daemon 模块文档与代码现状一致
verify:
  - cd backend && uv run pytest app/modules/mcp_registry app/modules/daemon/tests/test_mcp_config_endpoint.py -q
  - cd backend && uv run ruff check app/modules/settings && uv run mypy app/modules/settings
  - cd frontend && pnpm exec tsc --version && pnpm gen:types
  - cd frontend && pnpm vitest run "src/app/(dashboard)/settings/mcp/page.test.tsx" && pnpm lint
constraints:
  - mcp.platform_default / mcp.whitelist KV 行残留无害不清，不写迁移脚本（D-003 零迁移）
  - 不做 API 兼容垫层（项目未上线，CLAUDE.md 规则 11）；whitelist 治理层零改动（D-007）
  - backend/daemon 侧 mcp_registry 与换源代码本卡不动（task-01~10 已完成），只删旧端点与旧调用
  - 文档仅更 backend 三个模块文件 + _module-map.yaml，frontend/daemon 子项目模块文档留归档阶段同步
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
