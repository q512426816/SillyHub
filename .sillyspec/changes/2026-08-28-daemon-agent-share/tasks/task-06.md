---
id: task-06
title: '借用回退切 grants——borrow_resolver 数据源切换（语义等价）+ member_runtimes 开关端点同事务双写 grants + queries 薄壳委托 + 借用存量测试全量回归'
title_zh: '借用回退切 grants——borrow_resolver 数据源切换（语义等价）+ member_runtimes 开关端点同事务双写 grants + queries 薄壳委托 + 借用存量测试全量回归'
author: 'qinyi'
created_at: 2026-08-28 01:24:05
priority: P0
depends_on: ['task-02']
blocks: []
expects_from:
  task-02:
    - contract: BorrowResolution
      needs: [runtime, lender_user_id, grant_id]
provides:
  - contract: SharedDaemonsGrantField
    fields: [grant_id]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/agent/borrow_resolver.py
  - backend/app/modules/workspace/member_runtimes/router.py
  - backend/app/modules/workspace/member_runtimes/service.py
  - backend/app/modules/workspace/member_runtimes/queries.py
  - backend/app/modules/agent/tests/test_borrow_resolver.py
  - backend/app/modules/agent/tests/test_borrow_run_output.py
  - backend/app/modules/agent/tests/test_placement_borrow_integration.py
  - backend/tests/modules/workspace/test_member_runtimes.py
related_tests:
  - path: backend/app/modules/agent/tests/test_borrow_resolver.py
    reason: 用例 seed 仅置 binding shared=True 无 grant 行，数据源切 grants 后借用解析断言全部失败，需改 seed 建 grants 行
  - path: backend/app/modules/agent/tests/test_placement_borrow_integration.py
    reason: 派发/决策/interactive/写回四路借用用例同依赖 shared binding seed，切 grants 后失败需同步改 seed
  - path: backend/app/modules/agent/tests/test_borrow_run_output.py
    reason: test_dispatch_borrow_creates_audit_row 等借用审计与落 file 用例依赖 shared binding seed，需随 grants 切换更新
  - path: backend/tests/modules/workspace/test_member_runtimes.py
    reason: 断言开关只写 binding shared 列且 shared-daemons 列表读 shared 列，双写与数据源切 grants 后需补 grant 断言及 grant_id 响应断言
goal: >
  借用回退与共享开关全链路切到 grants 单一数据源（语义等价改写），开关端点同事务双写 grants 行，queries 保留薄壳委托。
implementation:
  - borrow_resolver.py 借用闸从 resolve_shared_daemon_for_borrow 切到 grants.queries.resolve_granted_daemon_for_borrow（enabled↔shared、在线、非本人、同工作区成员逐条等价），返回值携带 grant_id 供审计
  - member_runtimes/service.py set_my_binding_shared 与 revoke_shared 同一事务双写 shared 列与 grants 行（开=enabled 行 upsert，关=enabled=false），list_shared_daemons 数据源切 grants 并带 grant_id
  - queries.py resolve_shared_daemon_for_borrow（:171）改薄壳委托 grants.queries，原函数签名保留防破坏调用方
  - 上述存量测试 seed 改为建 grants 行并全量回归
acceptance:
  - 开/关共享后 grants 行与 shared 列同事务一致，撤销/停用后借用立即失效
  - shared-daemons 与开关端点签名响应结构不变仅新增 grant_id 字段
  - agent 模块借用存量测试（resolver/placement 集成/borrow_run_output）全量通过
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto
  - cd backend && uv run pytest app/modules/workspace tests/modules/workspace/test_member_runtimes.py -q --no-cov -n auto
constraints:
  - 开关双写同事务（R-07），鉴权唯一判定源为 grants，shared 列仅作 UI 缓存不参与鉴权
  - 端点签名与响应结构不变，grant_id 为纯增量字段（前端类型生成归 task-08）
  - queries.py 薄壳保留原函数签名不删不改调用方，借用查询语义等价不改错误文案
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
