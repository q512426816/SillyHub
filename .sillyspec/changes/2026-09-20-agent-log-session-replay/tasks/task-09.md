---
id: task-09
title: 'scoped 收口（daemon 5 文件 + backend 1 + 前端 3 组 + tsc 全绿，worktree git status 干净）'
title_zh: 'scoped 收口（daemon 5 文件 + backend 1 + 前端 3 组 + tsc 全绿，worktree git status 干净）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 09:50:21
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts
  - sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts
  - sillyhub-daemon/src/agent-log/parse-cursor-agent-transcript.ts
  - sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts
  - sillyhub-daemon/src/agent-log/registry.ts
  - sillyhub-daemon/src/host-fs-handler.ts
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/agent-log-replay.ts
  - frontend/src/components/daemon/agent-log-replay-body.tsx
  - frontend/src/components/daemon/agent-log-card.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
target_files: []
goal: >
  scoped 收口：全变更测试面一次跑绿 + 类型检查 + worktree 工作区清点，为 verify/commit
  交付干净基线。
implementation:
  - worktree sillyhub-daemon：pnpm vitest run tests/agent-log（5 个直改测试文件；liveness/ 不涉及）
  - worktree backend：uv run pytest -q --no-cov app/modules/platform_sync/tests/test_agent_log_messages.py
  - worktree frontend：pnpm vitest run src/lib/__tests__/agent-log-replay.test.ts src/components/daemon/__tests__/agent-log-replay-body.test.tsx src/components/daemon/__tests__/agent-log-card.test.tsx + pnpm exec tsc --noEmit
  - git -C <worktree> status 逐文件清点：改动面与 design §6 清单一致、无计划外文件、生成产物（openapi.json/api-types.ts）在列
  - 残差修复（如测试红/类型错）限定在 allowed_paths 内最小修改
acceptance:
  - 三组 scoped 测试全绿 + tsc --noEmit 零错误
  - git status 文件清单 = design §6 清单（25 条）无计划外改动
  - 禁全量测试（全量留给 CI）
verify:
  - git -C C:/Users/qinyi/IdeaProjects/multi-agent-platform-replay-redo status --short
  - 三组 scoped 命令退出码 0
constraints:
  - 只修残差不加新功能；不改 allowed_paths 外文件
  - 禁跑全量测试（CLAUDE.md 规则 0）；发现与本次无关的旧测试债记录不扩scope
  - 提交声明须 git show --stat 复核（quicklog 虚报坑纪律，docs/sillyspec/finished/quicklog-result-false-commit-claim.md）
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
