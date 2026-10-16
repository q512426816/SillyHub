---
id: task-08
title: 'title_fallback 列+迁移回填（哨兵''''）+session_crud 读列自愈+测试'
title_zh: 'title_fallback 列+迁移回填（哨兵''''）+session_crud 读列自愈+测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 10:13:55
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/20261016100000_agent_session_title_fallback.py
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/tests/test_session_router.py
target_files:
  - backend/app/modules/agent/model.py
  - NEW:backend/migrations/versions/20261016100000_agent_session_title_fallback.py
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/tests/test_session_router.py
goal: >
  会话标题预览持久化为 title_fallback 列（首条 user_input 前 30 字），列表路径消 1.4s 窗口函数扫描。
implementation:
  - 改 backend/app/modules/agent/model.py:670 AgentSession：加 title_fallback = Column(String(64), nullable=True)（title 列语义不动）
  - 新建迁移 backend/migrations/versions/20261016100000_agent_session_title_fallback.py：加列 + 存量回填（窗口函数按 (timestamp asc, id asc) 取每会话首条 channel='user_input' 的 substr(content_redacted,1,64)，与 backend/app/modules/daemon/router/session_crud.py:336-365 口径一致）；零 user_input 会话回写哨兵空串；SQLite/PG 双方言
  - 改 backend/app/modules/daemon/router/session_crud.py:281-333：组装改 title or title_fallback；仅 title IS NULL AND title_fallback IS NULL 的漏网会话跑收窄版窗口查询并回写（列或哨兵，自愈后永不再查）
  - 改 backend/app/modules/daemon/tests/test_session_router.py：读列优先/零输入哨兵不再重查（盲区3）/漏网自愈回写/迁移双方言（盲区4）
acceptance:
  - 列表路径不再对已有 fallback 的会话做窗口扫描（仅 NULL 漏网触发一次）
  - title 展示与现状逐字节一致（既有断言 test_session_router.py:594-664 零回归）
  - 迁移在 SQLite 测试库跑通且 alembic 链单 head
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_router.py -q --no-cov
  - cd backend && uv run alembic heads
constraints:
  - title 列语义不动（tool_report 自动标题/chat 恒 NULL 派生路径保持）
  - 响应 JSON 形状零变化（AgentSessionRead.title 不加字段）
  - 项目未上线允许一次性回填（CLAUDE.md 规则 11）
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
