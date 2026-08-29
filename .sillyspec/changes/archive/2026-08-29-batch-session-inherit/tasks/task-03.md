---
id: task-03
title: 'pass resume_session_id through interactive claim payload'
title_zh: 'backend claim interactive 分支 resume_session_id 白名单补透传'
author: 'qinyi'
created_at: 2026-08-29 21:15:48
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-05]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/tests/test_build_claim_payload.py
provides:
  - contract: InteractiveResumeClaim
    fields: [resume_session_id]
goal: >
  build_claim_payload interactive 分支（context.py:447-494 当前无此键）补 resume_session_id 白名单透传——重派 worker 的 lease metadata 已带该键但 interactive 分支不透传，daemon claim 拿不到续会话 id（FR-05 / design S3 backend ①）。
implementation:
  - interactive 分支（:447 起 stage/worker_depth 透传附近）补缺省透传——lease_meta.get 取 resume_session_id 命中才写 payload，键名与 batch 分支 :795-796 先例逐字一致（snake_case 单键）
  - 注入位置须在 tar/shared 两分支提前 return 之前，保证两路 claim payload 都携带（对齐 stage :484 先例）
  - 缺键短路不加 payload 键——存量 quick-chat/主控/普通 interactive lease 全链 undefined 穿透零回归（对齐 worker_depth :493 缺省先例）
  - 扩展 test_build_claim_payload.py 补 interactive 两态用例——metadata 含 resume_session_id 断言 payload 透传值一致，不含则断言 payload 无该键
acceptance:
  - interactive lease metadata 含 resume_session_id 时 claim payload 携带同名键且值一致（tar 与 shared 两路径）
  - metadata 无该键时 payload 不含 resume_session_id（缺省不下发零回归）
  - batch 分支 :795 既有透传与 payload 其它键行为不变
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_build_claim_payload.py -q --no-cov
  - cd backend && uv run mypy app
constraints:
  - 只补白名单透传单键——不改 payload 其它键与归一化逻辑，daemon 端消费归 task-04
  - 缺省不伪造默认值（无键不加键），向后兼容旧 lease 与旧 daemon
  - 不新建测试文件——扩展现有 test_build_claim_payload.py，不与 task-01 同文件防 Wave1 并行冲突
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
