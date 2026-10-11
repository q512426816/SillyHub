---
id: task-08
title: 'Caps flip and three-end sync with regression'
title_zh: 'caps 翻值同步——providers.ts 翻值 + 产物重跑 + 对齐守护 + 既有测试回归'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-11 00:04:04
priority: P0
depends_on: [task-05, task-06, task-07]
blocks: [task-09]
requirement_ids: [FR-07, FR-08]
decision_ids: [D-007@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/providers.ts
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/provider_caps.py
  - sillyhub-daemon/tests/mcp-server.test.ts
  - sillyhub-daemon/tests/mcp-config.test.ts
target_files:
  - sillyhub-daemon/src/interactive/providers.ts
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/provider_caps.py
goal: >
  按三通道 SPIKE 实测结论统一翻 caps 值，产物三端同步并跑全量相关回归。
implementation:
  - providers.ts PROVIDER_CAPS 按 task-05/06/07 结论翻 mcp 值（pi/codex/cursor 各自独立），注释块改写为新证据引用（spike-*.md + file:line）
  - 跑 node sillyhub-daemon/scripts/gen-provider-caps.mjs 重刷 frontend/src/lib/provider-caps.ts 与 backend/app/modules/agent/provider_caps.py（禁手写）
  - 跑 backend/app/modules/agent/tests/test_provider_caps_alignment.py 守护三端一致
  - daemon 既有回归：tests/mcp-server.test.ts、tests/mcp-config.test.ts、tests/pi-settings-mcp.test.ts、tests/codex-settings-mcp.test.ts、interactive/ 相关 driver 测试
acceptance:
  - test_provider_caps_alignment.py 全绿（产物与单源一致）
  - daemon 既有 MCP 契约与 driver 测试全绿零回归
  - 产物 diff 仅来自脚本生成（无手写痕迹）
verify:
  - node sillyhub-daemon/scripts/gen-provider-caps.mjs && cd backend && uv run pytest -q app/modules/agent/tests/test_provider_caps_alignment.py --no-cov
  - cd sillyhub-daemon && pnpm exec vitest run tests/mcp-server.test.ts tests/mcp-config.test.ts
constraints:
  - 生成产物禁止手写（唯一途径 gen-provider-caps.mjs）
  - 翻值必须与 SPIKE 实测结论一一对应，禁止无证据翻值
  - MCP SDK 锁 1.x 线不动


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
