---
id: task-05
title: 'Skip placeholder row for absent MASTER doc'
title_zh: 'P3 parser MASTER 缺席不补 exists=False 占位行'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:05:25
priority: P0
depends_on: []
blocks: [task-07]
requirement_ids: [FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/change/parser.py
target_files:
  - backend/app/modules/change/parser.py
goal: >
  parser 标准文档扫描循环对缺席 MASTER.md 不再追加 exists=False 占位行——MASTER
  是 brainstorm 拆分场景产物（本仓 291 变更仅 6 个存在），其缺席不构成缺失信号，
  占位行纯噪音；其余标准文档补缺席行行为不变（四件套缺席是归档门禁
  documents_complete 的可见性来源）。
implementation:
  - _parse_change 标准文档循环（parser.py 约 616-664 行）：文件不存在且 doc_type 为 MASTER 时直接 continue，不追加 exists=False 的 ParsedDoc（在 is_file 为假分支前置 MASTER 判断；MASTER 无 legacy alias，一并跳过别名探测）
  - 其余标准文档（proposal/requirements/design/plan/tasks/verify_result/module_impact）缺席仍补 exists=False 占位行，legacy alias（verification.md）探测与 warnings 逻辑零改动
  - 存量 MASTER exists=False 脏行不做迁移——下次 reparse 由 _sync_docs 的 seen_keys 删除环自然清理
acceptance:
  - 无 MASTER.md 的变更 parse 结果 docs 中不出现 doc_type=MASTER 行
  - 有 MASTER.md 时照发 exists=True 行（backend/app/modules/change/tests/test_parser.py:109 与 backend/app/modules/change/tests/test_router.py:192 断言保持绿）
  - 其余标准文档缺席占位行为不变（test_parser.py 的 plan/tasks/verify_result missing 断言与 STANDARD_DOC_TYPES 覆盖断言保持绿）
  - 归档门禁 REQUIRED_DOC_TYPES 不含 MASTER，门禁语义零变化
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_parser.py -q --no-cov
  - cd backend && uv run pytest app/modules/change/tests/test_router.py -q --no-cov
  - cd backend && uv run ruff check app
  - cd backend && uv run mypy app
constraints:
  - 只动 MASTER 一个 doc_type 的缺席分支，标准文档循环其余行为（legacy alias/mtime/warnings）零改动
  - 不做存量数据迁移、不加清理脚本（seen_keys 自然清理，D-004@v1）
  - 新测试用例（缺席不发/存在照发/存量清理）由 task-07 统一补，本 task 不新增测试文件
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
