---
id: task-04
title: 'Rewrite and extend backend tests for binding-pinned dispatch'
title_zh: 'backend 测试——:736 重写绑定钉定、test_representative_binding.py:124 全序涟漪更新、A3 三形态+边界包含子句、A1 两段式、双源同序、存量回归（depends_on: task-03）'
author: 'WhaleFall'
created_at: 2026-08-28 15:48:26
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v2, D-005@v1]
allowed_paths:
  - backend/app/modules/agent/tests/test_worker_subsession_dispatch.py
  - backend/app/modules/agent/tests/test_placement_member_binding.py
  - backend/app/modules/workspace/member_runtimes/tests/test_representative_binding.py
expects_from:
  - 'task-03: 钉定+预检行为'
  - 'task-01: 全序确定性'
goal: >
  按 design Wave C 重写并新增 backend 派发测试，锁死「绑定机器唯一钉定」新语义——
  :736 翻转为 QM 场景绑定钉定、test_representative_binding.py:124 按全序新语义更新
  （task-01 涟漪）、新增 A1 两段式 / A3 白名单预检 / 双源同序用例，并确认存量
  :283/:317/:684 零改动回归通过。本 task 只写测试，实现归 task-01/02/03。
implementation:
  - 'test_worker_subsession_dispatch.py 夹具微调（仅解耦所需）——_seed_context 支持解耦自有 runtime 与 owner 绑定（owner 在线机器可不建 workspace_member_runtimes 绑定行）、支持设置 ws.created_by（design 风险登记明示：分支1 走 created_by 匹配、分支2 走心跳序）；_stub_online_runtime 支持 allowed_roots JSON 列与心跳时刻可设（现硬编码 ~/.sillyhub 单根与固定 _TS），daemon_instances/daemon_runtimes 两表均需可设'
  - '重写 :736 test_own_runtime_preferred_over_representative 为 QM 场景绑定钉定用例（QM小程序→crrcdt-hubin 场景复刻）——owner 自有在线 runtime 但未绑定目标工作区、第三方用户绑定目标工作区且在线（心跳可更晚）→ dispatch 201 且断言 lease.runtime_id == 第三方绑定机器 runtime_id；docstring 注明语义翻转属需求变更（FR-01/FR-06、CLAUDE.md 规则9，非测试放水）'
  - 'test_representative_binding.py:124 owner 优先用例按全序新语义更新——task-01 补 ORDER BY 后分支1 候选集含全部成员绑定、不再依赖无序插入序碰巧先返 owner；显式设 owner 绑定 daemon 心跳最新 → 断言命中 owner 行（task-01 涟漪，需求变更非放水）'
  - '新增 A1 两段式 provider 用例——严格命中（binding provider == ws.default_agent）时 caplog 无 placement_provider_fallback 日志；仅异 provider 在线（绑定机器只有 codex runtime、default_agent=claude）→ 回退解析成功且有 fallback warning（FR-02 验收）'
  - '新增 A3 预检用例（三形态+边界包含子句）——绝对根越界（如根 /ws、daemon 视角路径在根外）→ 400 中文引导且不建子会话/run/lease；根全为 ~ 前缀 → 放行；空并集（instance 与名下 runtimes 均无绝对根）→ 放行；边界包含子句 /ws/root 命中根 /ws/root 或 /ws 均放行、/ws-other/x 拒（FR-04 验收，D-003@v2）'
  - 'test_placement_member_binding.py 新增双源同序用例——多成员多机绑定均在线时 resolve_representative_binding 与 resolve_daemon_instance_for_workspace 返回同一 daemon_instance_id（实例心跳 DESC 主序 + daemon_id ASC tie-break，并列心跳形态验证确定性）（FR-03，D-005@v1）'
  - '存量回归——:283/:317（常态 owner 机器即绑定机器、派发结果与旧行为一致）与 :684（跨区代表钉定）零改动通过；跑 verify 命令确认全绿'
acceptance:
  - 'FR-01/D-001@v1——owner 在线机器未绑定目标区、第三方绑定目标区在线时 lease.runtime_id == 第三方绑定机器 runtime id（:736 重写用例通过）'
  - 'FR-02/D-002@v1——严格命中无 placement_provider_fallback 日志；仅 codex 在线 + 默认 claude 时回退解析成功（A1 用例通过）'
  - 'FR-03/D-005@v1——多成员多机绑定均在线时两解析源返回同一 daemon_instance_id，心跳并列时 daemon_id 升序 tie-break（双源同序用例通过）'
  - 'FR-04/D-003@v2——绝对根越界 400 且不建 run/lease；全 ~ 根与空并集均放行；/ws/root 命中 /ws/root 或 /ws 均放行、/ws-other/x 拒（A3 用例通过）'
  - 'FR-06——:283/:317/:684 存量用例零改动通过；test_representative_binding.py:124 按全序新语义更新后通过'
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_worker_subsession_dispatch.py app/modules/agent/tests/test_placement_member_binding.py app/modules/workspace/member_runtimes/tests -q
constraints:
  - '不改任何源码——实现归 task-01/02/03，本 task 仅改 allowed_paths 所列三个测试文件'
  - '测试断言语义逐条对齐 requirements.md 各 FR 验收条款；:736 与 :124 的语义翻转是需求变更（design 兼容策略/FR-06 明示），非为通过而改测试（CLAUDE.md 规则9）'
  - '夹具微调仅限解耦所需（own_runtime 与 owner 绑定解耦、ws.created_by 可设、allowed_roots/心跳可控），不动无关夹具'
  - '禁止跑全量测试套件（CLAUDE.md 规则0），仅跑 verify 所列相关测试'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
