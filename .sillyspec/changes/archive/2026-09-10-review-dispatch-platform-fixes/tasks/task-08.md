---
id: task-08
title: 'regenerate-openapi-and-api-types-for-frontend-and-daemon'
title_zh: 'openapi 再 dump + frontend/daemon api-types 再生成（零漂移门禁）'
author: 'qinyi'
created_at: 2026-09-10 21:30:00
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
target_files:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
provides:
  - contract: LlmProviderCreate
    fields: [agent_kind, auth_field]
goal: >
  task-04 放开 backend llm_provider schema 后再生成三份契约产物（backend/openapi.json
  与 frontend/daemon 两侧 api-types），让 task-07 前端表单消费到 LlmProviderCreate
  的 agent_kind 联合扩员与 auth_field string 化最新类型（FR-03 契约同步）。
implementation:
  - cd frontend && pnpm gen:types——脚本（frontend/scripts/gen-api-types.mjs）自带先 dump backend/openapi.json 再生成 frontend/src/lib/api-types.ts，一条命令完成
  - cd sillyhub-daemon && pnpm gen:types——同款脚本生成 sillyhub-daemon/src/api-types.ts
  - 核对生成物关键变更——LlmProviderCreate/LlmProviderUpdate/FetchModelsRequest 的 agent_kind 联合含 pi、auth_field 化为 string（pattern 表达）；其余增量若来自工作树内并行变更（account-avatar-upload）的 schema 属预期一致态（design R-05）
  - 复核 daemon gen:types:check 零漂移（再生成后 git diff --exit-code 通过）
acceptance:
  - 三份产物均为脚本再生成——LlmProviderCreate.agent_kind 联合含 pi、auth_field 为 string，既有类型零丢失
  - cd sillyhub-daemon && pnpm run gen:types:check 通过（零漂移），frontend 生成后无残留漂移 diff
verify:
  - cd sillyhub-daemon && pnpm run gen:types:check
constraints:
  - 禁手写 openapi.json/api-types——只经 gen:types 脚本产出；不删既有类型与端点
  - 生成物混入并行变更（account-avatar-upload）schema 增量时不手工剔除——整体再生成是正确一致态（R-05），git 提交说明注明
  - 本卡仅消费 task-04 的 schema 放开，不携代其他后端代码改动；frontend 类型门禁归 task-07/09 复核
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
