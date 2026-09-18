---
id: task-07
title: 'pnpm gen:types 重跑（backend/openapi.json + frontend/src/lib/api-types.ts）'
title_zh: 'pnpm gen:types 重跑（backend/openapi.json + frontend/src/lib/api-types.ts）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: ['task-01', 'task-05']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
provides:
  - contract: ApiTypesPermissionUnion
    fields: [permission_union, menu_override_read]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
goal: >
  生成型任务——重跑 pnpm gen:types 把 task-01 的枚举 5 新值与 task-05 的三端点刷进
  backend/openapi.json 与 frontend/src/lib/api-types.ts，为前端 task-08+ 提供编译期类型（FR-04）。
implementation:
  - 先确认前端 node_modules 健康——pnpm exec tsc --version 能跑且 node_modules/.bin 有 openapi-typescript shim，半坏先 pnpm install --force 修复再生成
  - 在 frontend 目录跑 pnpm gen:types——脚本先以 uv run python scripts/dump_openapi.py 刷新 backend/openapi.json，再经 openapi-typescript 生成 src/lib/api-types.ts
  - 检查 diff 后同一次提交两产物（CLAUDE.md 规则 21，不让类型落后后端形成债）
acceptance:
  - api-types.ts 的 Permission 联合类型含 5 新值——menu:admin / skill:read / mcp:read / agent_profile:read / agent_session:read
  - MenuOverrideRead 类型与 /api/menu-overrides 三端点路径类型生成进 api-types.ts
  - openapi.json 与 api-types.ts 一致（gen:types:check 零 diff）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm run gen:types:check
constraints:
  - 禁手写 api-types.ts——只经 pnpm gen:types 生成
  - gen:types 附带确定性重写 provider-caps 产物（frontend/src/lib/provider-caps.ts 与 backend/app/modules/agent/provider_caps.py），预期字节相同零 diff，出现实质 diff 时停下上报勿提交
  - 本任务只产两产物，前端消费代码留给 task-08 及之后
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
