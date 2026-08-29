---
id: task-01
title: 'Add deterministic total ordering to workspace binding resolution queries'
title_zh: '双源同序全序——queries.py 两函数补 ORDER BY（实例心跳 DESC, daemon_id ASC）'
author: 'WhaleFall'
created_at: 2026-08-28 15:48:26
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/workspace/member_runtimes/queries.py
provides:
  - 'queries 两函数确定性全序（ORDER BY di.last_heartbeat_at DESC NULLS LAST, daemon_id ASC）——task-03 钉定与 worktree 路由收敛同机的依赖'
related_tests:
  - backend/app/modules/workspace/member_runtimes/tests/test_representative_binding.py
goal: >
  双源同序全序收敛（FR-03 / D-005@v1）：resolve_representative_binding 四个 SQL 变体
  （分支1 provider/非 provider + 分支2 provider/非 provider）与
  resolve_daemon_instance_for_workspace 统一补全序 ORDER BY di.last_heartbeat_at
  DESC NULLS LAST, daemon_id ASC，消除 LIMIT 1 无序扫描导致的两解析源（钉定链路 vs
  host_fs worktree 路由）选机分叉——跨机派发根因之一。
implementation:
  - 'resolve_daemon_instance_for_workspace（queries.py:145-155 路由查询）：SQL 加 daemon_instances inner join（workspace_member_runtimes wmr JOIN daemon_instances di ON di.id = wmr.daemon_id）并补 ORDER BY di.last_heartbeat_at DESC NULLS LAST, daemon_id ASC（替换裸 LIMIT 1 无序）；实现处注释明示：inner join 会静默丢弃 daemon_instances 行缺失的 stale 绑定行——属良性（该 daemon 实体已不存在，本就不可路由）'
  - 'resolve_representative_binding 分支1 provider 变体（:297-315，已 join di/dr）：LIMIT 1 前补统一 ORDER BY di.last_heartbeat_at DESC NULLS LAST, daemon_id ASC（owner 优先语义不变，仅 owner 多绑定多候选时确定选行）'
  - '分支1 非 provider 变体（:329-344 daemon 选择查询）：同键补 ORDER BY di.last_heartbeat_at DESC NULLS LAST, daemon_id ASC——分支1 的 daemon 选择序与路由查询同键（任务卡硬性要求）'
  - '分支2 provider 变体（:369-385）：排序键从 dr.last_heartbeat_at（runtime 心跳）改为 di.last_heartbeat_at DESC NULLS LAST, daemon_id ASC（实例心跳 + daemon_id tie-break）'
  - '分支2 非 provider 变体（:399-414）：聚合序从 MAX(dr.last_heartbeat_at) 改为实例心跳序——SELECT/GROUP BY 纳入 di.last_heartbeat_at（di 与 wmr.daemon_id 1:1，分组结果等价，满足 PG ONLY_FULL_GROUP_BY），ORDER BY di.last_heartbeat_at DESC NULLS LAST, wmr.daemon_id ASC'
  - '两函数 docstring 同步补全序语义（统一全序键 + D-005@v1 引用，更新 queries.py:130-141 解析顺序段与 resolve_representative_binding:263-290 docstring），风格对齐现有中文 docstring'
acceptance:
  - '多成员多机绑定且均在线时，resolve_representative_binding 与 resolve_daemon_instance_for_workspace 在相同候选集上返回同一 daemon_instance_id（收敛同机，FR-03 验收）'
  - '实例心跳完全并列时 daemon_id 升序 tie-break，两解析结果确定且一致（LIMIT 1 不再依赖无序扫描）'
  - '单绑定工作区两函数解析结果与旧行为一致（常态零变化；owner 机器即绑定机器的存量行为不回归）'
  - '路由查询对 daemon_instances 行缺失的 stale 绑定行静默丢弃，实现处注释已明示该行为及良性理由'
verify:
  - cd backend && uv run pytest app/modules/workspace/member_runtimes/tests -x -q
  - '已知涟漪：test_representative_binding.py:124 owner 优先用例将随全序新语义翻转失败——修复归 task-04（见 constraints），本卡跑挂属预期'
constraints:
  - '本卡不修任何测试：test_representative_binding.py owner 优先用例（:124）断言翻转的更新归 task-04（该测试路径由 task-04 的 allowed_paths 覆盖，本卡 allowed_paths 只含 queries.py，不改测试文件）'
  - '仅改 queries.py 两函数的 join/ORDER BY：不改函数签名、返回 dict shape、三分支结构、既有日志事件名（representative_binding_owner_hit 等）与异常吞没返回 None 契约'
  - '路由查询不加 di.status=online 过滤（design 文件变更清单只要求心跳 join）；两机在线性差异的残余分叉由 worktree RPC 失败 / daemon cwd 守卫 fail-loud 兜底（design 风险登记既有口径）'
  - '不动 batch 派发（placement._resolve_dispatch_runtime）与同文件其它共享查询（query_daemon_online_by_id / query_runtime_by_daemon_and_provider / resolve_shared_daemon_for_borrow）'
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
