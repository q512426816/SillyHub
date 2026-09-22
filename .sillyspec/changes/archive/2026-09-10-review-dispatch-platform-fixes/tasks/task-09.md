---
id: task-09
title: 'run-targeted-tests-and-type-gates-for-final-convergence'
title_zh: '相关定向测试与类型门禁全量收口'
author: 'qinyi'
created_at: 2026-09-10 21:30:00
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/credential-injector.ts
  - backend/app/modules/llm_provider/schema.py
  - backend/app/modules/mcp_gateway/tools.py
  - frontend/src/components/llm-providers/llm-provider-form.tsx
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  task-01~08 全部落地后的纯验证收口——跑本变更新增/受影响定向测试与类型门禁
  （daemon vitest 定向 + backend pytest 定向 + frontend vitest 定向 + 两仓类型
  零错 + daemon api-types 零漂移），FR-01~04 以测试与类型双门禁全绿收束。
implementation:
  - 跑 daemon 定向 vitest 五文件（pi-rpc-driver-turn-result / hub-client-worker-done-session / daemon-mission-worker-artifact / credential-injector / credential-injector-pi）与 pnpm typecheck
  - 跑 backend 定向 pytest（test_llm_provider_pi_kind.py + test_tools_new.py）与 frontend 定向 vitest（llm-provider-form.test.tsx）
  - 跑 frontend 类型门禁 pnpm typecheck（frontend/package.json scripts 等价于 tsc --noEmit）；复核 daemon pnpm run gen:types:check 零漂移
  - 任一命令失败即定位返工对应 task 后重跑，不在本卡内绕过/放宽断言或修源码
acceptance:
  - 上述全部定向测试零失败、daemon pnpm typecheck 零错、frontend typecheck 零新错、daemon gen:types:check 零漂移
  - 全程未跑任何全量测试套件（全量留 CI），验证范围仅限本变更定向集
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/pi-rpc-driver-turn-result.test.ts tests/hub-client-worker-done-session.test.ts tests/daemon-mission-worker-artifact.test.ts tests/credential-injector.test.ts tests/credential-injector-pi.test.ts
  - cd backend && uv run pytest app/modules/llm_provider/tests/test_llm_provider_pi_kind.py app/modules/mcp_gateway/tests/test_tools_new.py -q --no-cov
  - cd frontend && pnpm exec vitest run src/components/llm-providers/__tests__/llm-provider-form.test.tsx
  - cd frontend && pnpm typecheck
constraints:
  - 纯验证任务零源码改动（target_files 保留空），失败即返工对应 task 不放过
  - 禁止跑全量测试（CLAUDE.md 规则 0，全量留 CI）；仅跑本变更定向集
  - 活体回归（远端真派发）不在本卡范围（R-07，交付说明留用户执行）
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
