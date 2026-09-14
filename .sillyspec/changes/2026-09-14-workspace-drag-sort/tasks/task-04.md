---
id: task-04
title: '后端列表排序——list_with_owner 增 order_user_id LEFT JOIN 默认排序（无行=现状回归；仅 service.py，router 透传归 task-02）'
title_zh: '后端列表排序——list_with_owner 增 order_user_id LEFT JOIN 默认排序（无行=现状回归；仅 service.py，router 透传归 task-02）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:04:23
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1, D-004@v1, D-011@v1]
allowed_paths:
  - backend/app/modules/workspace/service.py
target_files:
  - backend/app/modules/workspace/service.py
goal: >
  让工作区列表吃到每人一套的拖拽顺序——list_with_owner 新增 keyword-only 参数
  order_user_id，rows_stmt LEFT JOIN UserWorkspaceOrder 改默认排序（无行最前 →
  sort_position ASC → created_at DESC），且无行用户与现状 created_at DESC 逐字节
  一致（FR-03，D-004@v1 无行落最前 / D-002@v1 保持服务端分页不改造）。
implementation:
  - list_with_owner 增 keyword-only 参数 order_user_id（uuid.UUID | None，缺省 None），与筛选参数 user_id 语义独立（order_user_id=排序视角用户，user_id=created_by 精确筛选），docstring 同步补充；None=不加 JOIN 保持现状排序（design 兼容策略「ORDER BY 分支由 order_user_id 有无决定」；router 恒传 user.id 归 task-02，本 task 落地时 router 仍走 None 现状分支保持绿）
  - rows_stmt（现 service.py 中 select(Workspace, User) 构造段）在 order_user_id 非 None 时追加 outerjoin(UserWorkspaceOrder, ON 条件=UserWorkspaceOrder.workspace_id == Workspace.id 且 UserWorkspaceOrder.user_id == order_user_id)，ORDER BY 改三元组——首键无行最前、次键 sort_position ASC、末键保持 Workspace.created_at DESC
  - 排序键跨方言写法（进实现，PG/SQLite 行为一致）——首键 col(UserWorkspaceOrder.sort_position).is_(None) 降序（两方言均 false<true，DESC 把无行卡排最前，等价 NULLS FIRST 语义），禁用 PG 专有 NULLS LAST；次键 col(UserWorkspaceOrder.sort_position).asc()；末键 col(Workspace.created_at).desc()（无行组内与并列位置回退现状序）
  - total 计数语句（total_stmt）不 JOIN 排序表、不受影响；filters/limit/offset 逻辑零改动（四路筛选与服务端分页行为不变，设计目标 5）
acceptance:
  - 无排序行用户（order_user_id 传入但该用户零行）列表顺序与现状 created_at DESC 逐字节一致（LEFT JOIN 全 NULL 分支退化，全局验收 3 兼容项）
  - 有行用户——有行卡按 sort_position ASC；无行卡（backfill 后新建）落最前（D-004@v1）；无行组内与并列 sort_position 按 created_at DESC 稳定
  - total 计数语句不 JOIN 排序表，计数结果与改动前一致
  - q/type/unclassified/status/user_id 四路筛选叠加默认排序时行为与现状一致（设计目标 5，分页 limit/offset 不变，D-002@v1）
verify:
  - cd backend && uv run ruff check app/modules/workspace/service.py
  - cd backend && uv run mypy app/modules/workspace/service.py
  - cd backend && uv run pytest -q --no-cov app/modules/workspace/tests/test_service.py app/modules/workspace/tests/test_router.py（既有列表测试回归——router 未传 order_user_id 走现状分支；排序断言扩展归 task-05）
constraints:
  - 仅改 backend/app/modules/workspace/service.py；router.py 两处调用（backend/app/modules/workspace/router.py:301、backend/app/modules/workspace/router.py:316）的 order_user_id=user.id 透传归 task-02，本 task 禁碰 router.py
  - 不加必填参数破坏既有调用（缺省 None=现状分支）；列表 HTTP 接口零 breaking change（不加 Query 参数）
  - sort_position 不出现在任何 DTO/响应体（design 字段数据流约束——消费侧只依赖列表行相对顺序）
  - PG/SQLite 双方言兼容，禁 PG 专有排序语法；禁止跑全量测试；本 task 不新增测试（无行=现状回归断言归 task-05）
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
