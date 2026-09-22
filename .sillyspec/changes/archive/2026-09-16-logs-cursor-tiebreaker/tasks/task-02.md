---
id: task-02
title: 'session_insights.py 日志端点新增 before_id Query 参数透传 + 单独传 before_id 无 before 422 校验（先例 machines.py:488-494 / session_team.py:420-436）'
title_zh: 'session_insights.py 日志端点新增 before_id Query 参数透传 + 单独传 before_id 无 before 422 校验（先例 machines.py:488-494 / session_team.py:420-436）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:17:13
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/router/session_insights.py
target_files:
  - backend/app/modules/daemon/router/session_insights.py
provides:
  - field: before_id (query, uuid, optional)
    to: read_model.get_agent_session_logs（task-01 消费）/ OpenAPI（task-04 重导出）
goal: >
  日志端点暴露可选 before_id 查询参数并透传 service；单独传 before_id 无 before 时 422
  fail-explicit（防新参数被静默忽略）。
implementation:
  - :379 before 参数旁新增 before_id: uuid.UUID | None = Query(None, description=与 before 组合的复合游标 id tiebreaker)
  - 端点体开头校验：before_id is not None and before is None → 422（参数组合依赖，先例 session_team.py:420-436 同款语义）
  - :424 service 调用透传 before_id=before_id
acceptance:
  - GET 带 before+before_id 正常响应；只带 before_id 无 before → 422
  - docstring/Query description 注明复合游标语义与 422 行为
verify:
  - cd backend && uv run ruff check app/modules/daemon/router/session_insights.py && uv run ruff format --check app/modules/daemon/router/session_insights.py
constraints:
  - 不改既有 before/after/q/limit 参数语义
  - 422 用仓库既有错误响应风格（对齐 session_team 先例写法）
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
