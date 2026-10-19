---
id: task-03
title: 'Frontend refresh status-code routing + tests + call-site audit'
title_zh: '前端刷新状态码分流 + 测试 + 调用点审计'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 15:53:07
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04, FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/lib/token-refresh.ts
  - frontend/src/lib/api.ts
  - frontend/src/lib/__tests__/token-refresh.test.ts
target_files:
  - frontend/src/lib/token-refresh.ts
  - frontend/src/lib/api.ts
  - frontend/src/lib/__tests__/token-refresh.test.ts
goal: >
  doRefresh 按状态码分流（5xx/408/429 抛 ApiError 不清会话；401/403/其余 4xx 返 null 明确失效）+ api.ts 契约注释 + 分流测试 + 13 处调用点抛错容错审计（FR-04/FR-05，D-004@v1）。
implementation:
  - 先写测试：frontend/src/lib/__tests__/token-refresh.test.ts 增用例——503/504 抛 ApiError 且 useSession 未被 clear、401/403 返 null、2xx 返 token 对（沿用 loadTokenRefresh + fetch mock 骨架，锚 token-refresh.test.ts:98-142）
  - token-refresh.ts doRefresh（锚 :86 if (!resp.ok) return null）：改按状态码分流——先判 resp.status >= 500 或 408 或 429 则抛 ApiError（带实际状态码/中文文案）；其后 401/403/其余 4xx 返回 null
  - frontend/src/lib/api.ts:229-257 仅改契约注释：null=明确失效才 clear+redirect；抛错=瞬态不清会话自然传播（代码逻辑不动）
  - 审计 13 处 ensureFreshAccessToken 调用点（api.ts/app-shell.tsx/health.ts/spec-workspaces.ts/explorer.ts/session-attachments.ts/change-files.ts/daemon/session-export.ts/file/api.ts 两处/ppm/problem.ts/ppm/export.ts 两处）：逐点确认抛错传播为请求失败可重试、无未处理 Promise 拒绝（app-shell.tsx:216 已有 .catch(() => {})）
acceptance:
  - 新用例全绿：503/504 抛错且 clear 未被调、401 返 null、2xx 返对；既有单飞/超时用例全绿
  - typecheck / lint 零错；审计结论逐点记录（无未处理拒绝或已修复）
verify:
  - cd frontend && pnpm vitest run src/lib/__tests__/token-refresh.test.ts
  - cd frontend && pnpm typecheck && pnpm lint
constraints:
  - 只改分流与注释；不动单飞锁/超时路径/SSE 路径语义；isAuthEndpoint 防递归行为不变
  - 不得把 5xx/408/429 落入 null 分支（design Grill B-002 归类优先级）
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
