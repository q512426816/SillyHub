---
id: task-01
title: 'daemon runSillyspecInit 去 --no-skills + 门控提升 3.32.2 + run-sillyspec-init.test.ts 断言反转（spec-sync.ts / tests/run-sillyspec-init.test.ts）'
title_zh: 'daemon runSillyspecInit 去 --no-skills + 门控提升 3.32.2 + run-sillyspec-init.test.ts 断言反转（spec-sync.ts / tests/run-sillyspec-init.test.ts）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 10:21:23
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-004@v1, D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/tests/run-sillyspec-init.test.ts
target_files:
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/tests/run-sillyspec-init.test.ts
goal: >
  init lease 执行体恢复 sillyspec init 自带 skills 复制段（spawn 参数去掉 --no-skills，修订
  2026-08-15 D-004@v1），使 --tool 各工具目录（claude/codex/openclaw/opencode/zcode）在
  初始化时落 sillyspec-* 技能；同时版本门控从 3.26.8 提升到 3.32.2（zcode 技能双层缺口
  v3.32.2 才修复，老 CLI 静默忽略 --tool zcode）。
implementation:
  - sillyhub-daemon/src/spec-sync.ts:1848 spawn args 数组删除 '--no-skills' 一项（保留 --dir/--spec-dir/--workspace-id/--tool 四类参数不变）
  - 同文件 :1666 附近块注释与 :1675 MIN_SILLYSPEC_VERSION_FOR_INIT 常量改 '3.32.2'，注释补 D-004@v1 修订留痕（本变更 D-001@v1 supersedes 旧语义）与 3.32.2 门控理由（zcode 双层缺口 sillyspec commit 016968bd）
  - sillyhub-daemon/tests/run-sillyspec-init.test.ts:184 断言反转——expect(initCall.cmd).not.toContain('--no-skills')；门控用例改双分支：mock version '3.32.2' 放行 / '3.26.8' 拒绝（sillyspec_init_cli_too_old）
acceptance:
  - spawn argv 不再含 --no-skills（run-sillyspec-init.test.ts 断言反转通过）
  - MIN_SILLYSPEC_VERSION_FOR_INIT === '3.32.2' 且 3.26.8 被 compareSemver 判旧拒绝
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/run-sillyspec-init.test.ts
constraints:
  - 不改 runSillyspecInit 函数签名（RunSillyspecInitParams 不变，仅内部 argv）
  - 不动 handleInitLease 六步编排（spec-sync.ts:2040 起）
  - 不动 --tool 兜底 ['claude'] 逻辑（spec-sync.ts:1840）
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
