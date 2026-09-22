---
id: task-05
title: '后端测试 test_move_order.py——契约 422 分支/幂等 backfill/to 分页数学/精度重排/D-004 回归/分页数量不变量'
title_zh: '后端测试 test_move_order.py——契约 422 分支/幂等 backfill/to 分页数学/精度重排/D-004 回归/分页数量不变量'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:04:23
priority: P0
depends_on: ['task-02', 'task-03', 'task-04']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-08]
decision_ids: [D-014@v1]
allowed_paths:
  - NEW:backend/app/modules/workspace/tests/test_move_order.py
target_files:
  - NEW:backend/app/modules/workspace/tests/test_move_order.py
expects_from:
  task-02:
    - contract: WorkspaceMoveResponse
      needs: [workspace, rebalanced, rank]
goal: >
  新建 backend/app/modules/workspace/tests/test_move_order.py，以 HTTP 级测试把 move
  契约 422 分支、幂等 backfill、to 分页数学、精度耗尽整集重排、D-004 列表排序回归、
  FR-01 双用户顺序隔离与 D-014 分页数量不变量钉进可回归断言，覆盖
  FR-01/FR-02/FR-03/FR-08 全部分支（task-02/03/04 三个实现任务的验收闸门）。
implementation:
  - 夹具与风格：复用 backend/conftest.py 根级夹具（client（httpx.AsyncClient）/ auth_headers（管理员）/ db_session），用例风格对齐 app/modules/workspace/tests/test_router.py（直调 API + 断言 status/code/中文文案）；workspace/tests/ 目录无本地 conftest.py，勿新建——种子数据用 db_session 直插模型或既有 fixture 模式
  - 种子 helper：批量构造 N（> 2×page_size）个 active workspace（db_session 直插 Workspace 行或 POST /api/workspaces），供分页数学/重排/不变量用例复用
  - 契约 422 三类（FR-02/D-013）：三选一违反（锚点全缺 / after_id+before_id 同传 / after_id==before_id 同值）→ HTTP_422_MOVE_ANCHOR_CONFLICT；锚点不可见（id 不存在 / 不在可见集合 / deleted_at 非空软删 / status ∉ {active,archived}）→ HTTP_422_MOVE_ANCHOR_NOT_VISIBLE；自锚（after_id=被移动卡自身）→ HTTP_422_MOVE_ANCHOR_SELF；均断言中文文案
  - to="prev_page_tail" 且被移动卡在第 0 页 → 422（FR-02 末分支）
  - 幂等 backfill（D-006@v2）：同一用户连续两次 move 后 user_workspace_orders 行数不重复增长（重复 move 不重复插入）
  - to 分页数学（D-012）：下带 {to="next_page_head"} → 响应 rank=(P+1)×page_size（下页页首）；上带 {to="prev_page_tail"} → rank=P×page_size-1（上页页尾）；越界收敛到序列尾/首；page_size 显式携带与默认 12 两条路径各测
  - 中点+精度耗尽（R-01）：构造相邻卡位置贴死（对同 pair 反复 move 或 db_session 直写已耗尽的浮点值）→ 触发同一事务整集重排，断言 rebalanced=true 且最终顺序正确
  - D-004 回归：无排序行用户列表 = created_at DESC 与现状完全一致；backfill 后新建 workspace 物化落最前（min(pos)-1024×n 区段）
  - FR-01 两用户顺序隔离：用户 A move 后 A 列表顺序变化，用户 B 列表顺序与此前完全一致
  - D-014 分页数量不变量：move 前后 total 不变；逐页拉取各页恒 page_size（末页允许不满）；全序列无重复 id、无空页/丢卡
  - 列表排序 LEFT JOIN 回归（FR-03）：混合有行/无行用户排序 = (无行最前, sort_position ASC, created_at DESC)；四路筛选与 limit/offset 行为不变
  - 鉴权分支（D-007）：非管理员对不可见 workspace move → 403
acceptance:
  - 上述用例全部落地且通过，覆盖 design 文件变更清单 test_move_order.py 断言项与 FR-01/02/03/08 全分支
  - 错误文案断言为中文（对齐 backend/tests/core/test_error_message_l10n.py 守护口径）
  - 断言基于 design「接口定义」公开契约（错误码/字段/顺序/total），不断言 service 内部实现细节
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/workspace/tests/test_move_order.py
constraints:
  - 禁止跑全量测试（CLAUDE.md 规则 0），只跑本文件
  - 只新建测试文件、不改产品代码；发现实现与 design 不符时如实登记（fail），不得改断言迁就实现
  - 不在本 task 顺手实现 service/router 行为（实现缺口退回 task-02/03/04）
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
