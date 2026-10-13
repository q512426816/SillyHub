---
id: task-01
title: 'backend session-changes endpoint'
title_zh: '后端会话关联变更列表端点'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 12:20:26
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v2, D-003@v1]
allowed_paths:
  - backend/app/modules/change/router.py
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/test_session_changes_endpoint.py
target_files:
  - backend/app/modules/change/router.py
  - backend/app/modules/change/service.py
  - NEW:backend/app/modules/change/tests/test_session_changes_endpoint.py
provides:
  - contract: 会话关联变更列表端点
    fields:
      - 'GET /api/workspaces/{workspace_id}/changes/-/by-session/{session_id}'
      - '200 响应 list[ChangeSummary]（含 is_thin/current_stage/last_pushed_at 投影）'
      - '排序语义——未归档优先、created_at desc；404 会话不存在或不属于该工作空间'
goal: >
  新增「会话 → 关联变更列表」反向只读端点，前端悬浮面板的数据源（FR-01）：
  change_session_links M:N 表是会话-变更关联唯一真相，但平台此前只有正向查询。
implementation:
  - service.py 新增 `list_changes_for_session(workspace_id, session_id)`：select(Change).join(ChangeSessionLink).where(link.session_id == session_id, Change.workspace_id == wid, Change.location != 'deleted')，order_by created_at desc + limit `_SESSION_CHANGES_MAX = 100`（对齐 router.py:95 `_CHANGE_SESSIONS_MAX = 200` 惯例）
  - 复用 `ChangeService.enrich_summaries(changes)`（service.py:2154，list[Change] → list[ChangeSummary]）批量投影 is_thin/last_pushed_at/pending_review 等计算字段（禁 N+1）
  - Python 最终排序（规避 PG/SQLite 方言差异，对齐 router.py list_change_sessions 模式）：`location != 'archive'` 优先 → created_at desc
  - router.py 新增端点（注册顺序放 `/changes/{change_id}/sessions` 端点附近；`-` 占位符写法对齐 platform_sync/router.py:209 `GET /changes/-/spec-manifest`）：先校验 AgentSession 存在且 workspace_id 匹配（查 agent_sessions 表），否则 HTTPException(404, detail="会话不存在或不属于该工作空间")（中文，l10n 守护测试把关）；权限 Depends(require_permission(Permission.CHANGE_READ))，response_model=list[ChangeSummary]
  - 同卡写 pytest（NEW backend/app/modules/change/tests/test_session_changes_endpoint.py，参照同目录既有测试的 fixture/conftest 模式）：空关联返回 []；多变更排序断言（未归档在前、组内 created_at desc）；location='deleted' 排除；归档变更正常返回；404（会话不存在/跨工作空间）；is_thin 投影字段非默认值断言
acceptance:
  - GET /api/workspaces/{wid}/changes/-/by-session/{sid} 返回 list[ChangeSummary]，排序=未归档优先+created_at desc，deleted 不出现
  - 会话不存在或不属于 wid 时 404 且 detail 为中文文案
  - 无关联变更时 200 空列表（不 404）
  - pytest 新测试文件全绿（聚焦：仅跑 backend/app/modules/change/tests/test_session_changes_endpoint.py）
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_session_changes_endpoint.py -q --no-cov
  - cd backend && uv run ruff check app/modules/change/ && uv run ruff format --check app/modules/change/
constraints:
  - 零 migration：不改任何表结构（复用 change_session_links + changes 既有列）
  - 不改 AgentSessionRead/AgentSessionListItem 等会话 DTO（D-003 否决的 DTO 内嵌路线不做）
  - 不新增 N+1 查询（必须走 enrich_summaries 批量管道）
  - 中文注释与报错文案（CLAUDE.md 规则 12；l10n 守护）
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
