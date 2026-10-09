---
id: task-02
title: 'daemon SILLYSPEC_VALID_TOOLS 补 zcode + 新增映射测试（task-runner/runner-types.ts / NEW:tests/sillyspec-tool-mapping.test.ts）'
title_zh: 'daemon SILLYSPEC_VALID_TOOLS 补 zcode + 新增映射测试（task-runner/runner-types.ts / NEW:tests/sillyspec-tool-mapping.test.ts）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 10:21:23
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-004@v1, D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/task-runner/runner-types.ts
  - sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts
target_files:
  - sillyhub-daemon/src/task-runner/runner-types.ts
  - NEW:sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts
goal: >
  daemon 端 --tool 白名单与 sillyspec CLI v3.32.2 对齐：SILLYSPEC_VALID_TOOLS 补 'zcode'
  （6 值→7 值），使 zcode 探测命中时进入 --tool 交集（zcode 端 .zcode/skills 落技能）。
implementation:
  - sillyhub-daemon/src/task-runner/runner-types.ts:173 SILLYSPEC_VALID_TOOLS Set 增 'zcode'；:168-172 注释同步（7 值对齐 CLI v3.32.2，zcode 为 2026-10-08 后新增）
  - 新建 sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts：mapDetectedToSillyspecTools 三组用例——①['claude','zcode','copilot']→['claude','zcode']（zcode 放行+无关过滤）②['copilot','hermes','pi','kimi','kiro','antigravity']→[]（全不支持跳过）③[]→[]（空数组，兜底在 runSillyspecInit 层不在本函数）
acceptance:
  - SILLYSPEC_VALID_TOOLS.size === 7 且含 'zcode'
  - 新测试三组断言全过；mapDetectedToSillyspecTools 保持纯函数无兜底
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/sillyspec-tool-mapping.test.ts
constraints:
  - 不改 cli.ts 探测接线（cli.ts:1188-1196 现状已透传）
  - 不在 mapDetectedToSillyspecTools 内加兜底（兜底职责在 runSillyspecInit）
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
