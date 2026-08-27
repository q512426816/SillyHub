---
id: task-07
title: 'machines/runtimes-page 附加 shared_to_me 装配 + daemon router 挂载 grants 路由 + 单测'
title_zh: 'machines/runtimes-page 附加 shared_to_me 装配 + daemon router 挂载 grants 路由 + 单测'
author: 'qinyi'
created_at: 2026-08-28 01:24:05
priority: P0
depends_on: ['task-02', 'task-04']
blocks: []
expects_from:
  task-02:
    - contract: SharedMachineRow
      needs: [machine_id, display_name, lender_display_name, source_workspace_id, online]
provides:
  - contract: MachinesSharedToMe
    fields: [shared_to_me]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_machines_router.py
goal: >
  machines 与 runtimes-page 响应附加 shared_to_me（共享给我的机器）装配，并在 daemon router 挂载 task-04 定义的 grants 子路由。
implementation:
  - daemon/schema.py DaemonRuntimeListResponse（:446）与 DaemonMachineListResponse（:538）新增 shared_to_me 字段（列表项 DTO 复用 grants/schema.py SharedMachineView，默认空列表）
  - daemon/runtime/service.py list_machines 与 list_runtimes_page 装配附加调用 grants.queries.list_machines_shared_to_me（共享机器独立成块不混入 items）
  - daemon/router.py 仿 audit_router 先例 include grants router（落地 /api/daemon/shared-agents 系列端点，不动 main.py）
  - test_machines_router.py 补用例（普通用户含共享机器块/无共享空列表/admin 视图）
acceptance:
  - 同工作区且持 daemon:borrow 的成员在 machines 与 runtimes/page 响应看到 shared_to_me（含共享人/来源工作区/在线状态）
  - 无共享时 shared_to_me 为空列表，既有 machines/page shape 测试零失败
  - /api/daemon/shared-agents 管理与 active 端点经挂载后可路由（router 实现归 task-04）
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
constraints:
  - 修改类端点与 items 过滤零变化（owner-only FR-03，shared_to_me 为附加块不进 items）
  - shared_to_me 默认空列表保证既有子集式 shape 断言零失败（无断言失效的既有测试故不列 related_tests）
  - grants router 仅挂载不实现端点（定义归 task-04）
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
