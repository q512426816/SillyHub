---
id: task-02
title: 'mcp-tools-recursion-dispatch-and-depth-gates'
title_zh: 'mcp_tools 五端点递归链路、深度门与层 0 收口'
author: 'qinyi'
created_at: 2026-08-26 03:10:00
priority: P0
depends_on: ['task-01', 'task-03']
blocks: [task-09]
requirement_ids: [FR-02, FR-03, FR-07]
decision_ids: [D-001@v1, D-004@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/tests/test_subsession_recursion_dispatch.py
expects_from:
  - 'task-01 mission_worker_sessions_tree 全树枚举与 tree_depth 列——worker_done 成员校验/全完成枚举与 converge busy 计数换树来源；深度门读 tree_depth 做 O(1) 判定'
  - 'task-03 budget_force_ended_at 映射规则与全树分身集合——converge busy 前置的 mission_derive_status 已含孙层且预算强收后不再 running，converge 可出 degraded 收尾'
  - 'task-04 worker_depth 形参（软依赖）——prepare_interactive_dispatch 透传 worker_depth 写 lease metadata 供 daemon 分层；本卡不硬依赖该形参，缺失时 placement 侧读库按 tree_depth 兜底，不阻塞本卡验收'
goal: >
  mcp_tools.py 端点层全量升级递归链路（design §5.B/§5.E）——dispatch_worker /
  list_workers / get_worker_result / mission_status / worker_done 五端点统一
  调用方解析（分身爬根禁懒建 miss=404，D-004@v1）；dispatch 递归派发挂
  parent=调用会话 + tree_depth+1 + 深度门 400 + 禁 worktree_path 透传；
  converge 增层 0 收口 403（鉴权通道嗅探守卫，D-007@v1）；worker_done/busy
  枚举换全树（孙可达，Grill B3）。
implementation:
  - '_resolve_session_mission 增统一调用方解析——X-Session-Id 命中会话行后按 parent 判别，parent_session_id 非空（分身）沿 resolve_mission_for_session 爬根定位 mission 且禁懒建（miss=404，防在分身误锚新 mission）；parent NULL（主控/普通会话）保留 P1 懒建语义；上述规则同构适用全部五端点（原「只读三工具口径不变」作废，分身调只读工具同样走爬根）'
  - '_dispatch_worker_core 递归派发——新子会话 parent_session_id=调用会话 id（不再固定 mission.session_id）、tree_depth=调用会话.tree_depth+1 落库，owner=mission.created_by 与首 run 双标记不变；调用会话.tree_depth+1 > MAX_DISPATCH_DEPTH（=2 常量本文件单源，对齐 D-001@v1 总深 3）→ 400 中文「已达最大派发深度 3 层，孙分身不能再派工」零写入；分身调用的 payload.worktree_path 一律忽略置 None（递归派发禁 caller worktree 透传，孙层一律自建副本）'
  - '_converge_core 增调用方上下文（request 透传）——层 0 收口守卫按鉴权通道 header 嗅探（对齐 mcp_tools.py 897-899 通道判别先例，勿按用户角色实现），X-Session-Id 命中会话 tree_depth>0 → 403「只有主控会话可以收敛任务」；Bearer JWT 通道豁免（人工干预口）；无 Bearer 且无 X-Session-Id 的 apiKey 显式 mission_id 回退路径同样 403 防绕过'
  - '_worker_done_core 成员校验与全完成枚举、_converge_core busy 前置计数换 mission_worker_sessions_tree（Grill B3——漏换则孙调 worker_done 422、mission 永不可收敛）；worker_done 迟到 409 分支语义原样保留'
  - '新增 test_subsession_recursion_dispatch.py——分身派孙（parent 挂分身、depth=2 落库）、孙调 dispatch 400 零写入、分身调 list_workers/get_worker_result/mission_status 正常（爬根不 404）、分身调 converge 403 与 JWT 正常与 apiKey 裸调 403、孙 worker_done 可用、分身 payload.worktree_path 被忽略置 None'
acceptance:
  - '分身（depth=1）dispatch——新子会话 parent=分身 id、tree_depth=2，owner 与首 run 双标记沿用；孙（depth=2）dispatch → 400 中文且零子会话零 run 零 lease 写入'
  - '五端点解析——分身调 list_workers/get_worker_result/mission_status/worker_done 均沿爬根命中 mission 不 404；分身调用场景禁懒建，根上无活跃 mission → 404'
  - 'converge 通道守卫——分身调 converge 403、主控（tree_depth=0）正常、Bearer JWT 正常、apiKey 无 Bearer 无 X-Session-Id 裸调 403'
  - '孙 worker_done 经全树成员校验通过且全完成唤醒枚举含孙；迟到 409 分支行为与 P1 一致；递归派发的 worktree_path 不透传（孙 cwd 一律自建副本路径）'
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/agent/tests/test_subsession_recursion_dispatch.py
  - cd backend && uv run pytest -q --no-cov app/modules/agent/tests/test_worker_subsession_dispatch.py app/modules/agent/tests/test_worker_subsession_done.py app/modules/agent/tests/test_worker_subsession_converge_close.py app/modules/agent/tests/test_mcp_tools.py
  - cd backend && uv run ruff check app/modules/agent/mcp_tools.py && uv run mypy app/modules/agent/mcp_tools.py
constraints:
  - 'mcp_tools.py 唯一 owner=本卡（plan 拓扑铁律）——判据函数消费 task-03 换树后的 mission.py 既有接口即可，不改 mission.py/control.py/finalizer.py/placement.py'
  - '懒建语义只对 parent NULL 调用方保留——分身解析禁懒建 miss=404 是防误锚新 mission 的安全语义，勿放宽'
  - 'converge 守卫按鉴权通道嗅探判别（Bearer/X-Session-Id/apiKey header），禁止按用户角色或 mission owner 实现（D-007@v1）'
  - '存量 depth=1 分身获得派工能力为显式预期（FR-08，项目未上线）；三端集成冒烟与既有断言全量回归归 task-09'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
