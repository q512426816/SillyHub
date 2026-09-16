---
id: task-06
title: 'Add stage-status ingest regression tests (persist/idempotency/unknown-status/legacy-CLI/409/deleted/reparse-no-rollback/archived) [target:NEW:backend/app/modules/platform_sync/tests/test_stage_status_ingest.py]'
title_zh: '新增 test_stage_status_ingest.py（落库/幂等/未知枚举告警/旧 CLI 无 header/409 不落库/change_deleted 不落库/reparse 不回翻） [target:NEW:backend/app/modules/platform_sync/tests/test_stage_status_ingest.py]'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:05:25
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-06]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/platform_sync/tests/test_stage_status_ingest.py
target_files:
  - NEW:backend/app/modules/platform_sync/tests/test_stage_status_ingest.py
goal: >
  新增 P1 回归测试 test_stage_status_ingest.py，锚定 FR-01/02/03/06——progress POST
  接受后 ux_changes 行 current_stage/status 权威落库、幂等重放、未知枚举告警、
  旧 CLI 兼容、409/change_deleted 不落库、ingest 落库后 reparse 不回翻（R-01）。
implementation:
  - 新建测试文件，复用 platform_sync/tests/conftest.py 既有 fixture（client/db_session/shpsync_headers）与 test_router.py 范式——T1/T2 服务器钟 base 链（base 取 200 ack 的 last_pushed_at）、六表 payload（changes[0] 带 name/current_stage/status）；断言一律直查 Change 表（workspace_id+change_key 定位，test_router.py:817-835 同款），不改任何实现文件（被测实现由 task-02 提供）
  - ① 落库断言——首推 payload status='active'/current_stage='verify' → 200 后行 status='in_progress'（D-002@v1 映射）且 current_stage='verify' 覆盖占位行初值
  - ② 幂等重放——同 payload 二推（base 链式取服务器钟，test_repeat_push_keeps_single_change_row 同款）→ 行值无漂移、仍单行
  - ③ 未知枚举——payload status='weird' → caplog 断言命中 platform_sync.change_status_unknown，status 列不写（保持 'draft'）、current_stage 照写（FR-02）
  - ④ 旧 CLI 无 header 首推——仅鉴权 header、无任何 X-SillySpec-*（test_old_body_no_headers_accepted 范式）→ 分支 1 接受且落库断言同①（FR-06）
  - ⑤ 409 冲突不落库——首推落库 current_stage='verify' 后携旧 base_ts（T1 夹具必然 < 服务器钟）再推 current_stage='plan' 载荷 → 409，行值保持 'verify' 不被旧 payload 覆盖（FR-03）
  - ⑥ change_deleted 拒收不落库——预插 location='deleted' Change 行（test_change_deleted_guard.py _add_deleted_change_row 范式）→ 推送 409 code='change_deleted'，收件箱行不建、stage/status 不落（FR-03）
  - ⑦ reparse 不回翻（R-01 锚定用例）——ingest 落库 current_stage='verify' 后同 workspace 跑 ChangeService.reparse（parser 用 MagicMock 产出 current_stage='brainstorm' 的同名 parsed，test_reparse_guard.py 范式）→ 表值保持 CLI 权威 'verify'（progress 链必设 owner，change/service.py:2688 的 owner_id is None 守卫天然让位）
  - ⑧ archived 终态——payload status='archived' → status='archived' + current_stage='archived' + archived_at 首填，location 不动（仍 'active'）；再推一次 archived → archived_at 不漂移（仅首填，NFR-03）
acceptance:
  - ①~⑧ 八条用例全部跑绿，断言直查 Change 表（不经读侧投影）
  - 未知枚举用例 caplog 命中 platform_sync.change_status_unknown 且 status 列保持原值
  - 409 冲突与 change_deleted 两分支行值零变化（收件箱行不建、行值不被旧 payload 覆盖）
  - archived 终态 status/current_stage/archived_at 落库、location 不动、archived_at 幂等不漂移
  - 测试自包含新文件，不改动 service.py/conftest.py 等任何既有文件
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/test_stage_status_ingest.py -q --no-cov
constraints:
  - 仅新增该测试文件——service.py 等被测实现由 task-02 提供，本卡只读断言不改实现（allowed_paths 仅放新测试文件）
  - 不改 platform_sync/tests/conftest.py 与既有测试文件（fixture 齐备——shpsync_headers/client/db_session）
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
