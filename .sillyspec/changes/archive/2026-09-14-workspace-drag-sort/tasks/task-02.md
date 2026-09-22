---
id: task-02
title: '后端 move 端点——WorkspaceMoveRequest/Response schema + move 路由（三选一校验、鉴权、中文 422 文案）+ list 端点 order_user_id 透传'
title_zh: '后端 move 端点——WorkspaceMoveRequest/Response schema + move 路由（三选一校验、鉴权、中文 422 文案）+ list 端点 order_user_id 透传'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:04:23
priority: P0
depends_on: ['task-03', 'task-04']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-007@v1, D-012@v1, D-013@v1]
allowed_paths:
  - backend/app/modules/workspace/schema.py
  - backend/app/modules/workspace/router.py
target_files:
  - backend/app/modules/workspace/schema.py
  - backend/app/modules/workspace/router.py
provides:
  - contract: WorkspaceMoveRequest
    fields: [after_id, before_id, to, page_size]
  - contract: WorkspaceMoveResponse
    fields: [workspace, rebalanced, rank]
  - contract: 'move 端点 POST /api/workspaces/{workspace_id}/move'
    fields: [WorkspaceMoveRequest, WorkspaceMoveResponse]
expects_from:
  task-03:
    - contract: move_workspace
      needs: [move_workspace]
goal: >
  落地 move 端点的 HTTP 契约层（FR-02/FR-03 接线）：schema.py 新增
  WorkspaceMoveRequest/WorkspaceMoveResponse（锚点三选一 pydantic 校验 + 中文 422 文案），
  router.py 新增 POST /{workspace_id}/move（鉴权 + 非管理员行级 403 + 调
  service.move_workspace），并把 list 端点两处 list_with_owner 调用透传
  order_user_id=user.id，使排序请求/响应形状进入 OpenAPI 供 task-06 gen:types 消费。
implementation:
  - schema.py 新增 WorkspaceMoveRequest：after_id/before_id（uuid.UUID | None = None）、to（Literal["next_page_head","prev_page_tail"] | None = None）、page_size（int = 12，to 路径专用、与前端 PAGE_SIZE 常量同源）；pydantic model_validator 恰一非空校验——携带锚点计数 != 1（含同传/同缺）或 after_id == before_id 同值 → AppError(code="HTTP_422_MOVE_ANCHOR_CONFLICT", http_status=422) 中文文案（对齐 backend/app/modules/workspace/router.py:293-298 既有 AppError 422 惯例；无 null 置顶语义，D-013/Grill F-03）
  - schema.py 新增 WorkspaceMoveResponse：workspace（WorkspaceRead）/ rebalanced（bool）/ rank（int，移动后默认视图 0 基序号）；*Response 后缀对齐 schema.py 既有命名惯例（Grill F-10）；sort_position 不进任何 DTO
  - router.py 新增 POST /{workspace_id}/move 端点（response_model=WorkspaceMoveResponse，status_code=200）：鉴权 require_permission_any(Permission.WORKSPACE_READ)（措辞对齐列表端点 backend/app/modules/workspace/router.py:269 现状）；非平台管理员先 allowed_workspace_ids(session, user_id=user.id, permission=Permission.WORKSPACE_READ)（复用 backend/app/modules/workspace/router.py:313 既有模式），workspace_id ∉ allowed → AppError 403（code="HTTP_403_PERMISSION_DENIED"，对齐 backend/app/core/errors.py:231 既有码）
  - 端点内调 WorkspaceService.move_workspace，契约签名以 design「接口定义」为准钉死、不得增删参数或改返回形状：move_workspace(*, workspace_id, user_id, after_id, before_id, to, page_size, allowed_ids) -> tuple[Workspace, bool, int]；管理员传 allowed_ids=None、普通用户传 allowed
  - 组装并返回 WorkspaceMoveResponse(workspace=WorkspaceRead.model_validate(ws), rebalanced=..., rank=...)
  - list 端点（GET /api/workspaces）两处 list_with_owner 调用（backend/app/modules/workspace/router.py:301 管理员分支 / backend/app/modules/workspace/router.py:316 普通用户分支）各加 order_user_id=user.id 透传（FR-03 接线；LEFT JOIN/排序实现在 task-04 service 层，本 task 只透传）
acceptance:
  - POST /api/workspaces/{workspace_id}/move 端点存在并进入 OpenAPI schema（task-06 gen:types 的前置输入）
  - 三选一违反（锚点全缺 / 2-3 个同传 / after_id == before_id 同值）→ 422 code=HTTP_422_MOVE_ANCHOR_CONFLICT，错误文案为中文
  - 非管理员对不可见 workspace 调 move → 403；管理员与可见用户正常路径返回 200 {workspace, rebalanced, rank}
  - list 端点两分支均透传 order_user_id=user.id，既有 list 行为（四路筛选 + limit/offset 分页）零回归
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/workspace/tests/test_router.py
constraints:
  - 禁止跑全量测试（CLAUDE.md 规则 0），仅跑 workspace router 相关既有测试回归
  - 排序算法/backfill/锚点解析全部归 task-03（service 层），本 task 只做契约层与透传，不得在 router 内实现排序逻辑；不动 service.py/model.py（归 task-03/04/01）
  - service.move_workspace 契约签名钉死（design「接口定义」），不得增删参数或改返回形状
  - 错误文案中文（对齐 backend/tests/core/test_error_message_l10n.py 守护口径）；sort_position 不得出现在任何 DTO/响应体
  - 不改 list 端点其它行为（筛选/分页参数不动），只加 order_user_id 透传
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
