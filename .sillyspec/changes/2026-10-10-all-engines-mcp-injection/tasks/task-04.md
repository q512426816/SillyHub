---
id: task-04
title: 'Predicate capability gating and injection matrix tests'
title_zh: '谓词能力化——cli.ts isMainAgentSession 改经 getProviderCaps 查询 + mcp-config.test.ts 注入矩阵单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-11 00:04:04
priority: P0
depends_on: []
blocks: [task-08]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/tests/mcp-config.test.ts
target_files:
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/tests/mcp-config.test.ts
goal: >
  主控 MCP 注入谓词从 claude 硬编码改为按 caps 能力判定，补齐注入矩阵单测，为三引擎通道打开出口。
implementation:
  - sillyhub-daemon/src/cli.ts:993-997 isMainAgentSession 改为经 getProviderCaps(provider).mcp 判定（providers.ts:452-459 安全封装，禁直下标），stage 判定保持缺省或 orchestrator 不变
  - providers.ts 如需向 cli.ts 装配处导出 caps 查询则补导出（cli.ts 已 import interactive/ 模块无循环，Grill X1 已证）
  - sillyhub-daemon/tests/mcp-config.test.ts 补注入矩阵：caps.mcp=true 引擎 × stage 缺省/orchestrator 注入成立；mission_worker 全引擎不进主控（D-002）；caps.mcp=false 引擎不注入；未知 provider 默认拒绝不抛错
acceptance:
  - mcp-config.test.ts 矩阵用例全绿（四引擎×stage×caps + 未知 provider）
  - isWorkerSession（cli.ts:1118-1120）diff 为零——分身谓词不动
  - 既有 mcp-config.test.ts 断言零回归
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/mcp-config.test.ts
constraints:
  - 禁止动 isWorkerSession 与分身受限注入逻辑（D-002）
  - 禁止对 PROVIDER_CAPS 直接下标（必须经 getProviderCaps）
  - caps 翻值不在本 task（归 task-08），本 task 仅谓词机制与测试


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
