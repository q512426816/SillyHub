---
id: task-03
title: add-placement-stage-param-and-representative-pinning
title_zh: placement 增 stage 参数写 lease metadata 与代表 binding 钉定模式
author: qinyi
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: [task-01]
blocks: [task-05, task-06]
requirement_ids: [FR-02, FR-07]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/agent/placement.py
provides:
  - contract: prepare_interactive_dispatch 新增 stage 参数写 lease metadata.stage，钉定链路支持代表机器（跳属主校验）——task-05 子会话派发与 task-06 daemon 谓词消费（design §5.B）
    fields: [stage, pinned_runtime_id, pinned_skip_owner_check]
expects_from: []
goal: >
  给 interactive 派发链路补两个基建——prepare_interactive_dispatch 增 stage 参数写
  lease metadata.stage（透传 claim payload 供 daemon 谓词分身分支），并让钉定链路
  支持代表机器（钉定 runtime 但跳属主校验，跨 ws 场景 mission.created_by 常非
  代表机器属主，design §5.B / D-004@v1）。
implementation:
  - prepare_interactive_dispatch 增 stage 参数（str，缺省 None），非空时写 lease metadata 的 stage 键（写法对齐 dispatch_to_daemon 既有 metadata stage 写入），值约定复用 execution.py 的 MISSION_WORKER_STAGE 常量（不建副本），经 build_claim_payload 透传 daemon 谓词（daemon 侧消费归 task-06）。
  - 钉定链路放宽属主——_query_pinned_online_runtime 增可选旗标（或新增同构查询 helper），代表钉定模式下只按 id 加 status='online' 复查，跳过 user_id 属主谓词；不满足钉定仍抛 NoOnlineDaemonError，绝不静默换机（Grill C-01 语义保持）。
  - anchor 本机自有 runtime 优先的解析顺序由调用方（task-05）决定——先查自有、无则 resolve_representative_binding 解析后以钉定模式传入；本卡只提供跳属主校验的钉定原语。
acceptance:
  - stage 缺省 None 时 lease metadata 无 stage 键，存量 quick-chat 与变更会话创建零回归。
  - 传 stage 时 metadata.stage 落库且 claim payload 可见。
  - 代表钉定模式命中非本人属主的在线 runtime；runtime 离线或不存在时抛 NoOnlineDaemonError 不 fallback。
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/agent/tests/test_interactive_session_placement.py app/modules/agent/tests/test_placement_borrow_integration.py
  - cd backend && uv run mypy app && uv run ruff check .
constraints:
  - 不动 _resolve_dispatch_runtime 与 representative_fallback 既有分支语义（batch 派发路径零回归，代表钉定是新链路不是改旧链路）。
  - 属主跳过仅限显式旗标开启的钉定复查——普通 pinned_runtime_id（用户自选机器）的属主校验保持不变。
  - 不动 daemon 侧 stage 谓词与工具注入（task-06）；不动 dispatch_to_daemon batch 路径。
  - 新增单测归 task-15；本卡以既有 placement 测试集守护零回归。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
