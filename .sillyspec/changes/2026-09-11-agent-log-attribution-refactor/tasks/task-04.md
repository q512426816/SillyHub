---
id: task-04
title: 'backend attribution resolution tests'
title_zh: 'backend 归属解析测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 05:15:18
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: ['D-002@v1', 'D-006@v2']
allowed_paths:
  - backend/app/modules/platform_sync/tests/
target_files:
  - backend/app/modules/platform_sync/tests/test_agent_log_push.py
  - NEW:backend/app/modules/platform_sync/tests/test_agent_log_attribution.py
goal: >
  为 task-03 的 ctx-owner 两级 find 归属解析补齐并归位测试：hub 登记跨 harness
  挂接、两级 find 兜底、无主建桶、空桶不变、幂等重推、时间过滤回归、旧双键
  payload 落 quick 桶过渡期证据（FR-02/FR-03）。
implementation:
  - '既有断言归位（task-03 语义变化致红）：test_push_entry_level_ctx_groups_two_sessions（:735）改 quick 优先断言；test_push_tool_report_session_fields_and_provider_mapping（:881）改 aggregation_key="{ctx}" 与 title「本地 · {ctx}」；test_push_aggregation_idempotent_single_session（:689）改新聚合键幂等'
  - '新增 hub 登记后本地同 ctx 跨 harness 挂接：先带 hub_session_id 推送（平台 pi 会话）登记变更 X 绑定，再无 hub 推送同 change_key 的 zcode 条目 → 断言挂到该 pi 会话（FR-03 Given 2）'
  - '新增两级 find 分支用例：links 无该 ctx 行但存在 aggregation_key="{ctx}" 的 tool_report 会话 → 第二级兜底命中；两级均无 → find-or-create（origin=tool_report、title=本地 · ctx 名）；同 ctx 多候选（links 多行 / links+聚合键混合）→ 断言挂 last_active_at 最新'
  - '新增旧双键过渡期证据（plan 审查 F-1 / AC-4）：同 entry 同时带 change_key+quick_id 的 payload → 断言按 quick_id 归组、落 quicklog 绑定、不建 change 聚合会话'
  - '回归核对（不改语义仅确认全绿）：空 ctx 单桶（:787）、hub 时间重叠过滤跳过 stale 条目（:523）、同 payload 幂等重推归属稳定'
  - '用例归位：优先并入 test_agent_log_push.py；归属专项过密可拆 test_agent_log_attribution.py（design 文件清单预留，不拆则不建该文件）；fixture 复用 conftest shpsync_headers（workspace+token）与 ensure_platform_sync_table，用例经 router 认证路径推送不直调 service'
acceptance:
  - '上述新用例全绿；test_agent_log_push.py 既有非归属断言（鉴权/去重/scope/limit/prefetch）零回归'
  - '旧双键用例以断言固化 quick 优先落桶（AC-4 过渡期证据）'
  - '断言口径对齐 FR-03：命中只刷 last_active_at 不改 status；不出现 harness 一致性拦截断言（D-009 否决）'
verify:
  - 'cd backend && uv run pytest app/modules/platform_sync/tests/test_agent_log_push.py -q --no-cov（拆文件后追加 test_agent_log_attribution.py，按实际文件名）'
  - 'cd backend && uv run pytest app/modules/platform_sync/tests -q --no-cov -k "agent_log or quicklog"'
constraints:
  - '只写/归位测试，不改 service.py 语义（发现实现缺陷回流 task-03，禁止为过测试弱化断言）'
  - '不跑全量 backend 测试（CLAUDE.md 规则 0），仅 platform_sync 模块内关联用例'
  - '不新建 conftest 装置（现有 shpsync_headers/ensure_platform_sync_table 足够），不扩散到根 conftest'
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
