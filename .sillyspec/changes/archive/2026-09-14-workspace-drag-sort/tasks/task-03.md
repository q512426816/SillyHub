---
id: task-03
title: '后端 move 服务——幂等 backfill + 锚点解析（id/to 分页数学）+ 中点/整集重排 + rank 计算'
title_zh: '后端 move 服务——幂等 backfill + 锚点解析（id/to 分页数学）+ 中点/整集重排 + rank 计算'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:04:23
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-006@v2, D-008@v1, D-011@v1, D-012@v1, D-013@v1]
allowed_paths:
  - backend/app/modules/workspace/service.py
target_files:
  - backend/app/modules/workspace/service.py
provides:
  - contract: move_workspace
    fields: [move_workspace, _backfill_order_rows]
goal: >
  在 WorkspaceService 落地拖拽移动核心逻辑——move_workspace（幂等 backfill →
  id/to 双路锚点解析 → 浮点中点/±1024/精度耗尽整集重排 → 0 基 rank 返回）与
  私有 _backfill_order_rows，以钉死签名提供给 task-02 端点与 task-05 测试调用
  （FR-01 顺序持久化 / FR-02 跨页移动）。
implementation:
  - >-
    service.py 的 WorkspaceService 新增 move_workspace，签名钉死不可改（provides 契约，design「接口定义」service.py 段逐字照抄）：
    async def move_workspace(self, *, workspace_id: uuid.UUID, user_id: uuid.UUID, after_id: uuid.UUID | None, before_id: uuid.UUID | None, to: str | None, page_size: int, allowed_ids: list[uuid.UUID] | None) -> tuple[Workspace, bool, int]
    ——allowed_ids=None 表示平台管理员（与 list_with_owner 可见性语义一致）；返回 (移动后的 Workspace, rebalanced 诊断标志, 0 基 rank)；锚点三选一互斥校验归 task-02 pydantic 层，service 按已校验输入处理
  - move 事务四步（design 总体方案 Wave 1）——①await self._backfill_order_rows(user_id=..., allowed_ids=...) 幂等物化；②锚点解析（id 锚点或 to 枚举解析成 id 锚点）；③取锚点邻居算浮点中点；④单行 upsert 排序行并计算响应 rank；全部写路径单事务
  - _backfill_order_rows 幂等（D-006@v2，design backfill 物化段）——INSERT..SELECT WHERE NOT EXISTS 一次性物化「该用户可见 ∧ status IN (active, archived) ∧ 尚无排序行」的全部 workspace；首用户（零存量行）全集按 created_at DESC 赋 row_number×1024 递增；已有行时新增无行卡物化在 min(pos) - 1024×n 区段（无行组整体在现有最小位置之下、组内 created_at DESC）；软删（deleted_at 非空）行不物化；重复执行零新增行
  - 锚点解析（D-012@v1）——id 锚点直接取邻居；to 枚举在默认视图序列分页数学——取该用户默认视图有序 id 列表（可见 ∧ status=active ∧ deleted_at IS NULL，按显示序，一两百个直接整取），定位被移动卡 rank r、页 P=floor(r/page_size)，目标插入 rank=(P+1)×page_size（to=next_page_head，下页页首）或 P×page_size-1（to=prev_page_tail，上页页尾，P=0 时抛 AppError 中文 422）；越界收敛到序列尾/首；解析出相邻锚点卡后走统一中点路径
  - 中点与重排——after_id=A 时新位置=(pos(A)+pos(A 的后一个))/2，无后继=pos(A)+1024；before_id=B 对称（无前驱=pos(B)-1024）；中点结果与任一邻居相等（浮点精度耗尽）时同一事务内整集重排（按当前顺序重赋 1024×i）后重算本次位置，rebalanced=True（风险 R-01 应对）
  - rank 计算——移动后该卡在默认视图序列（可见 ∧ active ∧ 未软删，按显示序）中的 0 基序号；task-02 响应透传，前端 floor(rank/page_size) 换算页码（风险 R-07）
  - 锚点校验（D-013@v1）——AppError 中文文案 + per-instance code/http_status 覆盖（不改 errors.py，AppError 基类已支持实例级覆盖）——锚点不存在/不在可见集合（allowed_ids 限定）/deleted_at 非空/status ∉ {active, archived} → code=HTTP_422_MOVE_ANCHOR_NOT_VISIBLE；锚点为被移动卡自身 → code=HTTP_422_MOVE_ANCHOR_SELF
acceptance:
  - move_workspace 签名与 provides 契约逐字一致，mypy/ruff 通过；返回三元组语义=(移动后的 Workspace, 是否触发整集重排, 0 基 rank)
  - backfill 幂等——同一用户连续两次 move，第二次不再插入任何排序行；物化前后默认视图显示序零变化（D-004 回归约束）；软删行不物化（D-006@v2）
  - to 路径分页数学符合 design 锚点解析段——next_page_head 落下页页首、prev_page_tail 落上页页尾、越界收敛到序列尾/首、第 0 页 prev 抛中文 422（D-012@v1）
  - 中点路径——常规落位取浮点中点、边界邻居用 ±1024、精度耗尽触发同事务整集重排且 rebalanced=True（D-011@v1）
  - 锚点 422 分支——不可见/软删/状态非法 → HTTP_422_MOVE_ANCHOR_NOT_VISIBLE，自锚 → HTTP_422_MOVE_ANCHOR_SELF，文案中文（D-013@v1）
  - move 是纯重排——只写 user_workspace_orders 行，不增删 workspaces 行（分页数量不变量前提，断言归 task-05）
verify:
  - cd backend && uv run ruff check app/modules/workspace/service.py
  - cd backend && uv run mypy app/modules/workspace/service.py
  - cd backend && uv run pytest -q --no-cov app/modules/workspace/tests/test_service.py（既有 service 测试回归；move 行为断言由 task-05 的 test_move_order.py 覆盖）
constraints:
  - 仅改 backend/app/modules/workspace/service.py；不碰 router.py/schema.py（端点与 DTO 归 task-02），不改 app/core/errors.py（422 用 AppError 基类 per-instance code/http_status 覆盖，errors.py 构造器已支持）
  - move_workspace 签名钉死不可改（provides 契约，task-02 端点与 task-05 测试按此调用）
  - 所有写路径单事务；同用户并发后写覆盖按 D-008@v1 接受，不加乐观锁
  - 错误文案中文；错误码命名对齐 errors.py 惯例（HTTP_422_ 前缀蛇形）
  - PG/SQLite 双方言兼容（INSERT..SELECT、浮点算术、upsert 写法），禁 PG 专有语法
  - 禁止跑全量测试（仅模块内相关）；本 task 不新增测试文件（test_move_order.py 归 task-05）
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
