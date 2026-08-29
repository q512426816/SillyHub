---
id: task-02
title: 'backend GET /sessions/{id}/usage endpoint + tests'
title_zh: 'backend 会话用量端点 + test_session_usage.py（聚合/归属/边界全用例）'
author: 'qinyi'
created_at: 2026-08-29 21:47:06
priority: P0
depends_on: [task-01]
blocks: [task-03, task-05]
requirement_ids: [FR-01, FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_session_usage.py
expects_from: 'task-01 provides：SessionService.get_session_usage + SessionUsageRead DTO'
goal: >
  暴露 GET /api/daemon/sessions/{session_id}/usage 端点（owner-only resource-hiding）并以端点级测试锁定聚合三态、空会话与归属语义。
implementation:
  - router.py 新增端点：get_current_principal 鉴权 + response_model=SessionUsageRead，委托 SessionService.get_session_usage；静态路径无遮蔽风险（/usage 在 /sessions/{id} 三段式之后同先例声明）
  - test_session_usage.py：①纯明细（多 run 多模型 SUM+排序）；②纯兜底（无明细行 run 四维并入、api_requests=0、「未记录」末位）；③混合（totals=两者之和）；④空会话 200 全 0 空 by_model；⑤他人会话 404/不存在 404/缺鉴权 401（对齐 test_permission_http_uplink 的 _admin_uid/_seed_user 构造先例）
acceptance:
  - AC-01/AC-02 全绿：聚合三态数字与种子数据手算一致；归属三态语义正确
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_session_usage.py
  - cd backend && uv run ruff check app/modules/daemon/router.py app/modules/daemon/tests/test_session_usage.py && uv run mypy app
constraints:
  - 不改 service/schema（归 task-01）；不改 OpenAPI 手写文件（生成物归 task-05）
  - 测试构造对齐既有 conftest（db_session/client/auth_headers），不新建 fixture 体系
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
