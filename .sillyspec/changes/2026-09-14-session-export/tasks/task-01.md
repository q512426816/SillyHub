---
id: task-01
title: 'add-session-export-request-schema'
title_zh: '后端 schema——daemon/schema.py 新增 SessionExportRequest（ids 1~50 + tier Literal）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:06:52
priority: P0
depends_on: []
blocks: ['task-03']
requirement_ids: [FR-01]
decision_ids: [D-002@v1]
provides:
  - 'SessionExportRequest(session_ids: list[UUID] min 1 max 50, tier: Literal["chat","full"])——OpenAPI 具名产源，前端 pnpm gen:types 消费'
allowed_paths:
  - backend/app/modules/daemon/schema.py
target_files:
  - backend/app/modules/daemon/schema.py
goal: >
  在 daemon/schema.py 新增导出请求模型 SessionExportRequest（session_ids 1~50 个
  UUID + tier chat/full Literal），为 POST /sessions/export 提供 body 校验与
  OpenAPI 具名产源（producer → 前端 gen:types），是导出链路的契约起点。
implementation:
  - 在 schema.py 会话域 DTO 区新增 SessionExportRequest（BaseModel），字段逐字对齐 design.md「接口定义」——session_ids：list[uuid.UUID] = Field(min_length=1, max_length=50)，tier：Literal["chat", "full"]
  - 附变更注释（导出请求 DTO、producer=OpenAPI→api-types.ts）；uuid/Literal/Field 均为文件既有导入，不新增 import、不动既有模型
  - 去重与档位语义不在 schema 层做（端点层去重保序、服务层收原生参数），本层只做 min/max 与 Literal 约束
acceptance:
  - SessionExportRequest 可从 app.modules.daemon.schema 导入；session_ids 为 0 个/51 个、tier 非 chat|full 均抛 pydantic ValidationError
  - OpenAPI 中出现具名 SessionExportRequest，minItems=1 / maxItems=50 / tier enum 完整
verify:
  - cd backend && uv run pytest -q --no-cov tests/modules/daemon -k "schema or session_export"
  - cd backend && uv run ruff check app/modules/daemon
  - cd backend && uv run mypy app
constraints:
  - 遵循 design.md「接口定义」字段形状，不增删改字段名（前端 api-types 依赖具名 schema）
  - 只加 schema，不接线 router/service（归 task-02/03）；不加测试（task-04 统一写）；不跨模块 import ppm
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
