---
id: task-07
title: 'Add title normalization regression tests (helper four-state/documents re-derive/anti-resurrect guard/MASTER placeholder cleanup) [target:NEW:backend/app/modules/change/tests/test_title_normalization.py]'
title_zh: '新增 test_title_normalization.py（模板 H1 四态/documents 重派生/防复活守卫/MASTER 不发+存量清理） [target:NEW:backend/app/modules/change/tests/test_title_normalization.py]'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:05:25
priority: P0
depends_on: ['task-01', 'task-03', 'task-04', 'task-05']
blocks: []
requirement_ids: [FR-04, FR-05]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/change/tests/test_title_normalization.py
target_files:
  - NEW:backend/app/modules/change/tests/test_title_normalization.py
goal: >
  新增 P2a/P3 回归测试 test_title_normalization.py，锚定 FR-04/05——
  normalize_display_title 四态归一化、upsert_documents title 重派生、
  防复活守卫、MASTER 缺席不发占位行 + 存量脏行 reparse 清理。
implementation:
  - ① 直测 normalize_display_title（title_norm 纯函数，无 DB）四态——纯模板 H1（如「# 提案书（Proposal）」）→ change_key 去日期前缀（_DISPLAY_KEY_RE 同款 YYYY-MM-DD- 剥离，'2026-09-16-my-feature' → 'my-feature'）；「— key」后缀变体（「提案书（Proposal）— xxx」与「 — 」空格变体）→ 同样回退 key 派生；自定义 H1 → 原样；H1 缺失（None）→ key 派生（FR-04 / D-003@v1）
  - ② upsert_documents 重派生——POST documents 推四件套（最深文档 tasks.md 为派生源，_TITLE_STAGE_ORDER 序）：模板 H1 → 直查 Change 行 title == key 去日期前缀；再推自定义 H1（如「# 我的自定义标题」）→ title 原样保留；change/tests conftest 无 shpsync_headers，文件内自建 workspace+shpsync_ token helper（test_router.py _make_ws_and_shpsync 同款范式）
  - ③ 防复活守卫（R-06/GAP-1）——预插 location='deleted' Change 行（已删 key）后迟到 POST documents → 不重建 ux_changes 行、不派生 title；对照未删 key 照常建行/更新 title
  - ④ MASTER 占位行（ChangeParser 直测，ChangeParser() + tmp 变更目录，test_parser.py silly_root 范式）——目录无 MASTER.md → parsed.docs 无 doc_type='MASTER' 的 exists=False 行；其余标准文档缺席仍照发 exists=False（documents_complete 门禁可见性不变，FR-05）；有 MASTER.md 时照发 exists=True
  - ⑤ 存量脏行清理（reparse 真文件范式，test_reparse_delete_closure.py 的 _make_ws/_make_spec_ws/_seed_change 同款）——预插 Change + ChangeDocument(doc_type='MASTER', exists=False) 脏行，spec_root 落无 MASTER.md 的变更目录 → ChangeService.reparse 后该 MASTER 行被 _sync_docs seen_keys 删除环清理，其余 doc 行保留（FR-05 / D-004@v1）
acceptance:
  - normalize_display_title 四态（纯模板/「— key」后缀变体含空格变体/自定义/H1 缺失）断言全绿
  - documents 推送两条重派生路径（模板 H1 归一化 / 自定义 H1 原样）直查 Change.title 断言全绿
  - 已删 key 迟到 documents 推送不建行（防复活守卫命中），未删 key 对照组照常生效
  - MASTER 缺席不发 exists=False 行、存在时照发 exists=True、其余标准文档补缺席行行为不变
  - 存量 MASTER 脏行经一次 reparse 被 seen_keys 删除环清理且其余 doc 行保留
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_title_normalization.py -q --no-cov
constraints:
  - 仅新增该测试文件——title_norm.py/parser.py/service.py 实现由 task-01/03/04/05 提供，本卡只读断言（allowed_paths 仅放新测试文件）
  - 不改 change/tests/conftest.py 与既有测试文件（workspace/token helper 文件内自建）
  - 遵守 plan.md 要点 3——测试夹具不得收录裸英文「Proposal」等英文标题当模板（会连坐 parser 既有英文 H1 fixture 断言）
  - 遵守 CLAUDE.md 规则 0——只跑本文件相关测试，全量回归留给 task-08/CI
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
