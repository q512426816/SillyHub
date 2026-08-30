---
id: task-08
title: assemble-frontend-types-and-bind-field-passthrough
title_zh: 前端类型与组装——injectSession bind 字段透传、invoke_name 手写类型与生成产物提交
author: qinyi
created_at: 2026-08-26 23:43:50
priority: P0
depends_on: ['task-06', 'task-07']
blocks: [task-05]
requirement_ids: [FR-06, FR-07]
decision_ids: [D-002, D-003]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/custom-skills.ts
  - frontend/src/lib/__tests__/daemon-session.test.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
provides:
  - contract: SessionInjectOptions
    fields: [bind_change_key, bind_quick_id]
  - contract: PlatformSkillSummary
    fields: [invoke_name]
expects_from:
  task-06:
    - contract: ManifestInvokeName
      needs: [invoke_name]
  task-07:
    - contract: SessionInjectRequest
      needs: [bind_change_key, bind_quick_id]
goal: >
  前端类型与组装收口——custom-skills.ts 手写补 invoke_name、pnpm gen:types 重生成提交 api-types.ts 与 openapi.json（规则 21）、daemon.ts injectSession 组装透传 bind_change_key/bind_quick_id，供 task-03 回填名计算与 task-05 发送组装消费。
implementation:
  - custom-skills.ts PlatformSkillSummary（:63-70）加可选 invoke_name（string 或 null）并注释标注来源 skills_bundle_service._summarize_skills 聚合新键——manifest 端点无 OpenAPI schema，属既有手写惯例不违反规则 21（R-9 人肉跟改）
  - 确认前端 node_modules 健康（pnpm exec tsc --version 可跑，防假报错）后 cd frontend && pnpm gen:types——task-07 的 SessionInjectRequest 新字段经生成管线进 api-types.ts，产物连同 backend/openapi.json 一并提交
  - daemon.ts injectSession（≈:913-939）仿 page_context 有值才带模式补 bind_change_key/bind_quick_id 两组装分支——SessionInjectOptions 经 Omit 生成类型自动获得新字段，无需改类型定义；daemon-session.test.ts 既有 injectSession 用例补 bind 字段下发与缺省不下发断言
acceptance:
  - api-types.ts 内 SessionInjectRequest 含 bind_change_key/bind_quick_id（生成版非手写），openapi.json 同步为 task-07 后端 schema
  - injectSession 携带 bind 字段时下发、缺省不下发——不使用联想时请求体零变化（对齐 page_context 既有形态）
  - PlatformSkillSummary 含可选 invoke_name 且注释标明来源；pnpm exec tsc --noEmit 与 daemon-session.test.ts 全绿
verify:
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/lib/__tests__/daemon-session.test.ts
constraints:
  - invoke_name 仅手写于 custom-skills.ts（manifest 不在生成管线）；api-types.ts 只能经 pnpm gen:types 生成，禁止手写（规则 21）
  - injectSession 既有字段（agent_profile_id/llm_provider_id/attachment_ids/page_context）组装逐字节不变；bind 业务接线归 task-05（7 发送点位）、回填名计算归 task-03——本卡只做类型与 client 组装
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
