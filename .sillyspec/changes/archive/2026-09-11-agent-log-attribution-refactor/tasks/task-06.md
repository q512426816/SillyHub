---
id: task-06
title: 'cross-repo-integration-smoke-real-cli-push-and-platform-attribution'
title_zh: '跨仓集成冒烟（真 CLI 推送 × 真平台归属）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 05:15:18
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-004@v2, D-007@v1]
allowed_paths:
  - NEW:.sillyspec/changes/2026-09-11-agent-log-attribution-refactor/verify-logs/integration-smoke.md
target_files: []
goal: >
  task-01~05 合龙后，用本机真 backend（开发库）+ 真 sillyspec CLI（zcode 会话 env）端到端冒烟
  新归属协议全链并落验证记录：own-only 推送、ctx-owner 跨 harness 挂接、quick 落桶、
  数据迁移演练（plan 全局验收 3/5 的实证证据）。
implementation:
  - '起本机 backend：make dev-up（postgres+redis）→ cd backend && uv run alembic upgrade head && uv run uvicorn app.main:app（:8000，.env 开发库）；若起服受阻退化为 pytest 夹具形态（backend/conftest.py httpx ASGITransport + platform_sync/tests/conftest.py shpsync_headers，先例 test_owner_smoke_e2e.py），但真 CLI 推送断言必须走真服务'
  - '造测试装置：开发库建 workspace+user → POST /api/workspaces/{id}/platform-sync-tokens 签 shpsync_ token（明文仅 201 返回一次）；再直插一条 agent_sessions 行模拟平台派发 pi 会话（hub 候选）'
  - '真 CLI 冒烟（主仓根、zcode env 进程）：export SILLYHUB_PLATFORM_URL=http://localhost:8000 SILLYHUB_PLATFORM_TOKEN=<token> 后跑 sillyspec run status（keep-prev）与 sillyspec run status --change 2026-09-11-agent-log-attribution-refactor（ctx 打标），对照 .sillyspec/.runtime/agent-session-log.json 留底断言 push payload 仅含 own 条目'
  - '断言平台侧（GET /api/agent-logs + 开发库直查）：own 条目落库且 agent_session_id 按 ctx 解析为聚合会话（「本地 · {ctx}」）；携 SILLYHUB_SESSION_ID=<hub 行 id> 再推同 ctx 条目（模拟 pi run 登记）→ 本地 zcode 同 ctx 条目挂到该 hub 会话（跨 harness 就挂）；跑一次 sillyspec quick 断言条目落 quick 桶并关联 quicklog；同 cwd 未跑 sillyspec 的窗口日志在任何会话视图零出现'
  - '迁移演练：cd backend && uv run alembic upgrade head（执行 task-05 迁移，四条清理生效）→ 重推收敛（重跑 CLI 推送，归属按新规则重建）→ uv run alembic downgrade -1 确认 no-op'
  - '证据落盘 verify-logs/integration-smoke.md：环境（命令+版本）、每步命令与输出摘录、断言结果，并对 plan 全局验收 5 条逐条给出结论'
acceptance:
  - '真 CLI 推送 payload 仅含 own 条目（对照留底），平台侧 agent_session_id 按 ctx 正确解析，status 等 keep-prev 语义不误清 ctx（FR-01/FR-04）'
  - '未跑 sillyspec 的本地窗口日志不出现在任何平台会话/变更/quicklog 视图（plan 全局验收 3 前半，FR-06）'
  - 'hub 登记 ctx 后，本地 zcode 同 ctx 条目挂到该平台 pi 会话（跨 harness 就挂，plan 全局验收 3 中段，FR-03）'
  - 'sillyspec quick 的条目落 quick 聚合会话并关联 quicklog（plan 全局验收 3 后半，FR-02）'
  - '迁移开发库演练通过：upgrade 后四条清理生效且重推归属收敛、downgrade -1 no-op（plan 全局验收 5，FR-05）；integration-smoke.md 落盘含命令/输出摘录/断言三要素且 5 条全局验收逐条有结论'
verify:
  - 'cat .sillyspec/changes/2026-09-11-agent-log-attribution-refactor/verify-logs/integration-smoke.md（断言记录与全局验收结论齐全）'
  - '按 integration-smoke.md 记录原样重放：起服 → 真 CLI 推送 → 平台侧断言 → alembic upgrade/downgrade'
constraints:
  - '不动产品代码：backend/sillyspec 两仓源码零改动，唯一产物是变更目录下验证记录；sillyspec 仓侧仅以只读命令参与，不留文件'
  - '本机 Windows（Git Bash）执行；SillySpec CLI 一律在主仓根目录跑，不 cd 进 worktree/子目录（CLAUDE.md 规则 22）'
  - '开发库数据可重置（CLAUDE.md 规则 11），不碰生产；不跑全量测试，仅本链路冒烟（CLAUDE.md 规则 0）'
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
