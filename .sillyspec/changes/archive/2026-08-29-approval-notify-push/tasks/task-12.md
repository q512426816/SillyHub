---
id: task-12
title: 'Backend integration regression + local.yaml notification module mapping + ruff/mypy closeout'
title_zh: '后端整合回归 + .sillyspec/local.yaml modules 补 notification 映射 + ruff/mypy 收口'
author: 'qinyi'
created_at: 2026-08-29 21:04:42
priority: P0
depends_on: ['task-04', 'task-05', 'task-06']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-011@v1]
allowed_paths:
  - .sillyspec/local.yaml
  - backend/app/modules/notification/tests/
  - backend/app/modules/platform_sync/tests/
  - backend/app/modules/change/tests/
  - backend/app/modules/daemon/tests/
goal: >
  后端四模块整合回归：补漏的 notification 整合用例、修正 platform_sync/change/daemon
  受影响的既有回归，并把 notification 模块映射补进 .sillyspec/local.yaml modules 块，
  ruff/mypy 全绿收口。
implementation:
  - .sillyspec/local.yaml modules 块新增一行 notification 映射（path backend/app/modules/notification/，test 命令对齐既有 daemon 行格式）
  - backend/app/modules/notification/tests/ 补整合用例覆盖跨模块链路（落库+SSE 下发+已读/消解端到端）
  - 修正 platform_sync/change/daemon 既有测试因通知挂钩产生的断言失效（真实文件名见各 tests 目录，如 change/tests/test_approval_notify_session.py、platform_sync/tests/test_owner_sync.py、daemon/tests/test_change_session.py）
  - ruff check . 与 mypy app 全绿
acceptance:
  - local.yaml modules 块含 notification 条目且 test 命令可直接执行
  - 四模块 pytest 全绿，无跳过的新失败
  - uv run ruff check . 与 uv run mypy app 均零错
verify:
  - cd backend && uv run pytest app/modules/notification app/modules/platform_sync app/modules/change app/modules/daemon -q --no-cov -n auto
  - cd backend && uv run ruff check .
  - cd backend && uv run mypy app
constraints:
  - 禁全量 pytest（只跑上述四模块）
  - 不改动各模块非 tests 目录下的源码——若回归失败根因在源码，回到对应 task 卡修正
  - local.yaml 只允许在 modules 块加 notification 一行，不动 known_failures 等其他块
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
