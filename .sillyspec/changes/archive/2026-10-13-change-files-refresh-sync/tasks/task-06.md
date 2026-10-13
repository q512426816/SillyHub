---
id: task-06
title: '收账——daemon tsc --noEmit + backend ruff/mypy 聚焦检查 + 两仓新增测试全绿 + 对照 design.md 文件变更清单核验无漂移 [target: sillyhub-daemon/src/sillyspec-manager.ts, sillyhub-daemon/src/daemon.ts, backend/app/modules/change/router.py]'
title_zh: '收账——daemon tsc --noEmit + backend ruff/mypy 聚焦检查 + 两仓新增测试全绿 + 对照 design.md 文件变更清单核验无漂移 [target: sillyhub-daemon/src/sillyspec-manager.ts, sillyhub-daemon/src/daemon.ts, backend/app/modules/change/router.py]'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 12:58:32
priority: P0
depends_on: ['task-03', 'task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/src/daemon.ts
  - backend/app/modules/change/router.py
target_files: []
goal: >
  收账：两仓静态检查 + 新增测试全绿 + 对照 design.md 文件变更清单核验无漂移——变更完整性收口。
implementation:
  - daemon：pnpm typecheck（tsc --noEmit）+ pnpm test 聚焦新测试文件
  - backend：uv run ruff check app/modules/change + uv run mypy app/modules/change（聚焦改动模块）+ pytest 聚焦两个测试文件
  - 对照 design.md 文件变更清单逐行核验：改动文件与 target_files 一致、无清单外漂移
  - 更新 tasks.md checkbox 勾选 + progress 记录
acceptance:
  - daemon typecheck 零错误、backend ruff/mypy 零错误
  - 两仓新增测试全绿 + test_files_router.py 回归全绿
  - design.md 文件清单与实际改动一致（无未声明文件被改）
verify:
  - cd sillyhub-daemon && pnpm typecheck && cd ../backend && uv run ruff check app/modules/change && uv run mypy app/modules/change
constraints:
  - 不跑全量测试/lint（CLAUDE.md 规则 0：全量留给 CI）
  - 本任务不改实现逻辑（发现缺陷回对应 task 修复后重跑）
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
