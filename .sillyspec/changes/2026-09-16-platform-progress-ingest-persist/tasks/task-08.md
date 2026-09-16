---
id: task-08
title: 'Update test_router.py:831 status assertion per FR-01 mapping + related regression sweep (pytest/ruff/mypy) [target:backend/app/modules/platform_sync/tests/test_router.py]'
title_zh: '连带断言更新（test_router.py:831 status 随 FR-01 映射值）+ 相关回归全绿 + ruff check + mypy app [target:backend/app/modules/platform_sync/tests/test_router.py]'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:05:25
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/platform_sync/tests/test_router.py
target_files:
  - backend/app/modules/platform_sync/tests/test_router.py
goal: >
  收口连带测试债 + 全量相关回归——test_router.py:831 的 status 断言随 FR-01 行为
  变更更新为映射值 'in_progress'（载荷 status='active' 的预期体现，非测试腐化），
  并跑 platform_sync + change 相关子集与 ruff/mypy 验证 FR-01~06 验收面全绿。
implementation:
  - 更新 backend/app/modules/platform_sync/tests/test_router.py:831——test_first_push_creates_placeholder_change_row 内的断言 `assert row.status == "draft"` 改为 `assert row.status == "in_progress"`（该用例 body changes[0] status='active'，D-002@v1 映射 active→in_progress 的预期体现），就近注释注明依据 FR-01 + design.md 测试策略段例外条款；同函数其余断言（current_stage/title/path/location/id）不动
  - 跑 platform_sync 模块全目录测试——upsert_progress 行为面回归（test_router/test_owner_sync/test_change_deleted_guard/test_pending_approval_broadcast 等既有用例全绿，FR-03 零回归）
  - 跑 change 相关子集——test_parser.py（MASTER/标题）+ test_title_normalization.py（task-07 产出，FR-04/05 验收面）
  - ruff check app + mypy app 收口——确认本变更各卡产出（service.py/title_norm.py/parser.py/两新测试文件）合规、无连带告警
acceptance:
  - test_router.py:831 断言为 'in_progress' 且 test_router.py 全文件测试通过
  - app/modules/platform_sync/tests 全目录 0 fail（含 task-06 新文件）
  - change 相关子集（test_parser.py + test_title_normalization.py）0 fail
  - ruff check app 与 mypy app 均退出码 0
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests -q --no-cov
  - cd backend && uv run pytest app/modules/change/tests/test_parser.py app/modules/change/tests/test_title_normalization.py -q --no-cov
  - cd backend && uv run ruff check app
  - cd backend && uv run mypy app
constraints:
  - 只改 test_router.py 一处断言（+就近注释）——发现实现层问题时回退对应 task-02/03 卡修复，禁止在本卡改实现代码
  - 其余既有用例若因 FR 行为变化失败，先判定是否预期体现（是→同法更新断言并注明依据；否→回退实现卡修复，遵守 CLAUDE.md 规则 9 禁止为过测试而改测试）
  - 遵守 CLAUDE.md 规则 0——禁止跑全量测试，全量回归留给 CI
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
