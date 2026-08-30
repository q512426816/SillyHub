---
id: task-13
title: '全量回归 + 环境走查验收'
title_zh: '全量回归 + 环境走查验收'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P0
depends_on: ['task-01','task-02','task-03','task-04','task-05','task-06','task-07','task-08','task-09','task-10','task-11','task-12']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/change/binding.py
  - frontend/src/components/sessions/session-list-panel.tsx
goal: >
  回归验收卡——task-01..12 落地后跑 local.yaml 全量 test/lint 链、frontend tsc 与 gen:types 零漂移检查，
  并在本机真实会话内走查变更/quick 两类 sillyspec 命令的自动绑定（R-01 覆盖验证），对照 requirements.md FR-01~06 与 NFR-01~04 逐条核验记录，供 verify 阶段 verify-result.md 使用。
implementation:
  - '全量测试链（local.yaml commands.test）——cd backend && uv run pytest -q --no-cov -n auto && cd ../frontend && pnpm test && cd ../sillyhub-daemon && pnpm test'
  - 'lint 与类型链——local.yaml commands.lint（ruff check + ruff format --check + mypy app + frontend pnpm lint + daemon pnpm typecheck）加 cd frontend && pnpm exec tsc --noEmit（node_modules 健康预检按 CLAUDE.md 规则 21）'
  - 'gen:types 零漂移——cd frontend && pnpm gen:types 后 git diff --exit-code -- src/lib/api-types.ts ../backend/openapi.json 必须零输出（NFR-04）'
  - 'daemon 零改动验证——git diff --stat -- sillyhub-daemon 输出为空（design §6 显式不动清单）'
  - '环境走查 FR-01——真实平台会话内执行 sillyspec run <阶段> --change <现有变更名>，变更详情会话卡出现该会话；同一会话再跑第二个变更验证一会话多变更的多对多成立'
  - '环境走查 FR-02（R-01 覆盖验证）——真实会话内执行 sillyspec run quick，CLI agent-logs 上报后快速修复抽屉关联会话卡出现该会话；旧版 CLI 未上报则记 FAIL 并标注环境依赖'
  - '对照 requirements.md FR-01~06 与 NFR-01~04 逐条核验（含 NFR-01 未跑 sillyspec 会话零行为变化），PASS/FAIL 加证据落 verify-result.md 素材，对齐 plan.md 全局验收标准 1-5'
acceptance:
  - 'local.yaml test 全链绿——backend pytest（-n auto）+ frontend vitest + daemon vitest 零失败；lint 链与 frontend tsc --noEmit 绿'
  - 'pnpm gen:types 后 api-types.ts 与 backend/openapi.json 零漂移（git diff --exit-code 通过）'
  - 'git diff --stat -- sillyhub-daemon 为空——daemon 侧零改动'
  - '走查两项绑定成立——变更侧与快速修复侧均出现关联会话，一会话多变更的多对多成立'
  - 'FR-01~06 与 NFR-01~04 逐条有 PASS/FAIL 核验记录（供 verify 阶段 verify-result.md）'
verify:
  - cd backend && uv run pytest -q --no-cov -n auto
  - cd frontend && pnpm test && pnpm exec tsc --noEmit
  - git diff --stat -- sillyhub-daemon
constraints:
  - '回归验收卡零新源码改动只验证不修码——发现问题回对应 task-01..12 卡返工后重跑本卡；allowed_paths 仅为被验证关键入口文件而非修改授权'
  - '环境走查在本机开发环境执行（backend 127.0.0.1:8001 + 真实 CLI agent-logs 上报）'
  - 'quick 绑定依赖 CLI 上报行为（R-01 平台侧无法兜底）——走查 FAIL 时按环境依赖记录，不为此加平台侧兜底代码'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
