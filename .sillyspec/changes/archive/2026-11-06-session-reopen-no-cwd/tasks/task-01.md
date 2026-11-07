---
id: task-01
title: 'daemon resume cwd 三级同源链（payload 非空串 → sessions.json 快照 → config.workspace_dir）+ 三级链测试'
title_zh: 'daemon resume cwd 三级同源链（payload 非空串 → sessions.json 快照 → config.workspace_dir）+ 三级链测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-06 23:03:28
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-002@v2]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/daemon-session-resume-route.test.ts
target_files:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/daemon-session-resume-route.test.ts
goal: >
  daemon 侧 SESSION_RESUME 恢复记录的 cwd 改三级同源兜底链（payload 非空串 → 本地 sessions.json 快照 → config.workspace_dir），使空 cwd 会话在 daemon 侧能解析出真实目录完成 SDK resume——reopen 链路的 daemon 前提。
implementation:
  - sillyhub-daemon/src/daemon.ts `_routeSessionResume` 构造恢复记录处（现 :9503 `cwd: (raw.cwd as string | undefined) ?? ''`）改为三级取值：payload.cwd 为非空字符串 → 本地 sessions.json 持久化快照按 sessionId 查 record.cwd（D-daemon-064 lastActiveAt 三级取值同构先例 :9517）→ `this._config.workspace_dir`；键缺省/null/空串三者同判空（空串非 nullish，`??` 不拦，须显式非空串门）
  - 新增 daemon 测试用例（sillyhub-daemon/tests/daemon-session-resume-route.test.ts）：payload 带非空 cwd 第一级命中；payload 缺 cwd 键/值为 null/值为空串三种形态均落快照级；快照无记录退 workspace_dir；三级链结果作为 record.cwd 传入 restoreAndReconnect
acceptance:
  - 三级链取值顺序与「非空串」口径逐形态有测试覆盖（含盲区 #1 null 显式形态、盲区 #4 工作区脏数据空串形态）
  - payload 带非空 cwd 时行为与现状逐字节一致（工作区会话零回归，FR-05）
  - record.cwd 恒为非空字符串（末级 workspace_dir 兜底恒有值）
verify:
  - pnpm -C sillyhub-daemon test -- daemon-session-resume-route
constraints:
  - 不改 `_resolveResumeLastActiveAt` 既有三级取值逻辑（FR-daemon-369 语义不得改写）
  - 不动 restoreAndReconnect/driver 内部；三级链只作用于 record.cwd 构造
  - 聚焦测试，禁跑全量
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
