---
id: task-07
title: 'F1a context_overflow attribution - daemon model-error types/classifier + backend ModelErrorType enum sync (unknown-value behavior probe) + pnpm gen:types + frontend normalize/error card + tests'
title_zh: 'F1a context_overflow 归因——daemon model-error types/classifier + backend schema Literal（实测未知值行为）+ pnpm gen:types + frontend normalize/错误卡 + 三端测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-12 21:01:59
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/model-error/types.ts
  - sillyhub-daemon/src/model-error/classifier.ts
  - sillyhub-daemon/tests/model-error/classifier.test.ts
  - backend/app/modules/daemon/model_error.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/components/agent-log/normalize.ts
  - frontend/src/components/agent-log/run-error-item.tsx
  - frontend/src/components/agent-log/__tests__/run-error-item.test.tsx
target_files:
  - sillyhub-daemon/src/model-error/types.ts
  - sillyhub-daemon/src/model-error/classifier.ts
  - sillyhub-daemon/tests/model-error/classifier.test.ts
  - backend/app/modules/daemon/model_error.py
  - backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/components/agent-log/normalize.ts
  - frontend/src/components/agent-log/run-error-item.tsx
  - frontend/src/components/agent-log/__tests__/run-error-item.test.tsx
goal: >
  context_overflow 全链路归因（daemon 分类 → backend ModelErrorType 同步 → pnpm gen:types →
  前端错误卡）。生产实证 runs 3-12「Prompt is too long」10 连败全落 unknown 无任何引导，
  本卡让该类失败在三端获得专属类型与中文引导文案，为 task-08 自动恢复编排提供归因前提（D-003）。
implementation:
  - 'sillyhub-daemon/src/model-error/types.ts:11 的 ModelErrorType 联合类型增加 "context_overflow"'
  - 'sillyhub-daemon/src/model-error/classifier.ts 归类规则插在 429 状态码规则（classifier.ts:129-134 区）之后、auth 规则之前；关键词（正则整体大小写不敏感）：Prompt is too long / maximum context length / context_length_exceeded / context window；ERROR_INFO 文案（META 形态参照 quota_exceeded classifier.ts:62 / rate_limited :67 / auth_failed :72）：message「会话上下文超出模型窗口」、hint「平台将自动压缩会话并续跑；若自动恢复失败请手动 /compact 或新建会话」、retryable=false'
  - 'backend ModelErrorType 同步：design.md 预写 schema.py，grep 实测定义在 backend/app/modules/daemon/model_error.py:15（class ModelErrorType(StrEnum)，:28 ModelErrorDTO），schema.py 内无此类，落点修正至此；同步枚举后实测 pydantic 对未知值（daemon 上报未收录 type）的校验行为（422 拒绝风险 → 宽松校验预案），实测结论留痕于测试注释'
  - '仓库根 pnpm gen:types（package.json:15）重新生成 frontend/src/lib/api-types.ts 与 backend/openapi.json（CLAUDE.md 规则 21 禁手写；跑前先确认前端 node_modules 健康：pnpm exec tsc --version 能跑）'
  - 'frontend/src/components/agent-log/normalize.ts:354 MODEL_ERROR_TYPES 白名单透传 context_overflow；frontend/src/components/agent-log/run-error-item.tsx:67 MODEL_ERROR_META 增加 context_overflow 专属中文卡（进行态「上下文已满，正在自动压缩续跑」/ 终态「请手动压缩或新建会话」，design.md W2-T1）；quota 失败卡透出 error_detail 的 resetAt 倒计时'
acceptance:
  - 'daemon：四组关键词归类用例全命中（扩展现有 sillyhub-daemon/tests/model-error/classifier.test.ts，无需新建）'
  - 'backend：context_overflow 通过 ModelErrorDTO 校验用例通过；未知值行为实测结论留痕（测试注释写明实测值与结论）'
  - 'frontend：类型链 pnpm exec tsc --noEmit 编译通过；run-error-item 的 context_overflow 错误卡渲染用例通过；pnpm gen:types 幂等（重复生成后 git diff 为空）'
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/model-error/classifier.test.ts
  - cd backend && python -m pytest app/modules/daemon/tests/test_close_interactive_run_model_error.py
  - cd frontend && pnpm exec vitest run src/components/agent-log/__tests__/run-error-item.test.tsx src/components/agent-log/__tests__/normalize.test.ts
  - cd frontend && pnpm exec tsc --noEmit
  - 仓库根 pnpm gen:types && git diff --exit-code frontend/src/lib/api-types.ts backend/openapi.json
constraints:
  - 'frontend/src/lib/api-types.ts 仅由 pnpm gen:types 生成，禁手写（CLAUDE.md 规则 21）'
  - 'error_code 与 error_detail 正交（backend/app/modules/daemon/run_sync/service/close_run_steps.py:288，D-009），禁改写 error_code 写入路径'
  - '禁全量测试，仅跑本卡相关测试（CLAUDE.md 规则 0）'
<!-- 执行期对账修正（verify 收口，与该 task review 结论一致）：target_files 移除 frontend/src/components/agent-log/__tests__/normalize.test.ts —— normalize.test.ts 既有断言零回归未改动（类型扩展由 tsc+run-error-item 表驱动用例覆盖） -->

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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
