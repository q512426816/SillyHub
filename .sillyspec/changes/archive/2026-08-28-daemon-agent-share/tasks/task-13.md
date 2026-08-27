---
id: task-13
title: shared-machine-runtimes-contract
title_zh: 共享机器视图补 runtime 明细（契约修复）
author: qinyi
created_at: 2026-08-28 04:02:00
priority: P0
depends_on: [task-09, task-10]
blocks: [task-11]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/grants/queries.py
  - backend/app/modules/daemon/grants/tests/test_grants_authorization.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_machines_router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/use-daemon-machines.ts
  - frontend/src/components/daemon/shared-machines-section.tsx
  - frontend/src/components/daemon/__tests__/shared-machines-section.test.tsx
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx
provides:
  - contract: SharedMachineRuntimes
    fields: [runtime_id, provider, online]
goal: >
  修复 Wave 6 审查发现的契约缺口：SharedMachineView 五字段无 runtime 明细，
  共享机器「会话」锁 machine_id 会 404、picker 第二步无 runtime 可选——
  机器级 grant 的会话创建需要 runtime 粒度数据。
implementation:
  - backend：list_machines_shared_to_me 每机器附带其 daemon_instance 的 runtimes（runtime_id/provider/online）；SharedMachineView 加 runtimes 默认空列表（新 DTO SharedMachineRuntimeView 三字段）；router 装配透传
  - backend 测试：共享机器 runtimes 字段断言（含多 provider/离线）
  - gen:types 再生成（openapi+api-types 同提交）
  - 前端：use-daemon-machines 的 machineCandidates 共享条目携带真实 runtimes；shared-machines-section「会话」按钮锁第一个在线 runtime（无在线保持禁用）；session-config-bar 共享条目 runtime 可选
  - 收敛：session-config-bar 的 useActiveSharedAgents 切到 lib/daemon.ts 的 fetchSharedAgentsActive（删本地直调）
acceptance:
  - 共享机器卡「会话」点击后悬浮会话锁定该机器在线 runtime（lock id 为 runtime_id 非 machine_id），可成功创建会话
  - picker 第二步共享机器可选 provider runtime
  - 无在线 runtime 时按钮禁用
  - SharedMachineView.runtimes 进 openapi/api-types（可选字段默认空）
verify:
  - cd backend && uv run pytest app/modules/daemon/grants app/modules/daemon/tests/test_machines_router.py -q --no-cov -n auto
  - cd frontend && pnpm gen:types && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/components/daemon/__tests__/shared-machines-section.test.tsx "src/components/sessions/__tests__/session-config-bar.test.tsx"
constraints:
  - SharedMachineView 既有五字段零变化（runtimes 纯增量可选）
  - 回退链/普通会话零影响
  - 两类型文件同一提交（规则 21）
related_tests: []
