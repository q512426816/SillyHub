---
id: task-02
title: 'backend change-module schema and passthrough for contract v2'
title_zh: 'backend schema 与透传'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 20:03:38
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/change/schema.py
  - backend/app/modules/change/scope_audit.py
  - backend/app/modules/change/tests/test_scope_file_diff.py
target_files:
  - backend/app/modules/change/schema.py
  - backend/app/modules/change/scope_audit.py
  - backend/app/modules/change/tests/test_scope_file_diff.py
expects_from:
  task-01: [rows[].cross_repo, repos[]（key/anchor{source,base,head,label}/anchor_label/totals{files,additions,deletions,planned,unplanned,untouched}/degraded/degraded_reason）]
provides:
  openapi_scope_audit_v2_fields: [ScopeAuditRow.cross_repo, ScopeAuditResponse.repos（ScopeAuditRepo{key,anchor,anchor_label,totals,degraded,degraded_reason}）]
goal: >
  backend change 模块消费 daemon RPC result 的契约 v2 增量：ScopeAuditRow.cross_repo 与
  ScopeAuditRepo 族 pydantic schema + get_scope_audit 防御透传，非法/缺省形态回退 repos=[]（D-002）。
implementation:
  - backend/app/modules/change/schema.py:692 ScopeAuditRow 增 cross_repo: str | None = None
  - schema.py 新增 ScopeAuditRepoAnchor（source/base/head/label 四个 str|None）、ScopeAuditRepoTotals（files/additions/deletions/planned/unplanned/untouched 全 int|None）、ScopeAuditRepo（key:str + anchor/anchor_label/totals/degraded/degraded_reason 带默认值）；ScopeAuditResponse（schema.py:713 附近）增 repos: list[ScopeAuditRepo] = []
  - backend/app/modules/change/scope_audit.py:385-408 get_scope_audit rows 循环补 cross_repo 投影（isinstance str 守卫，同 declared/attribution 风格）；result.get("repos") 为 list 时逐条防御构造 ScopeAuditRepo（isinstance dict + key str 否则跳过，嵌套 anchor/totals 逐字段归一），否则 repos=[]
  - backend/app/modules/change/tests/test_scope_file_diff.py 增 scope-audit 端点用例：FakeHub 返回 v2 形态（跨仓行 + 三仓 repos[]）断言 DTO 透传 / 无 repos 键 → repos==[] / 非法条目跳过
acceptance:
  - v2 形态 FakeHub 下响应 JSON 含 cross_repo 与 repos 逐字段正确（key/anchor/anchor_label/totals 三态计数/degraded_reason）
  - 无 repos 键/非 list 形态 → repos==[]（回退零回归，既有端点用例全绿）
  - OpenAPI 导出含新字段（gen:types 在 task-03 消费）
verify:
  - cd backend && uv run pytest -q app/modules/change/tests/test_scope_file_diff.py
  - cd backend && uv run ruff check app/modules/change/schema.py app/modules/change/scope_audit.py app/modules/change/tests/test_scope_file_diff.py
  - cd backend && uv run mypy app/modules/change/schema.py app/modules/change/scope_audit.py
constraints:
  - 只做 additive：既有字段/端点/错误映射族（scope_audit.py AppError 族）零改动
  - 错误与注释文案中文；防御构造风格对齐既有 rows 循环（isinstance 守卫、非法跳过）
  - 禁跑全量测试，仅跑本文件相关测试（CLAUDE.md 规则 0）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
