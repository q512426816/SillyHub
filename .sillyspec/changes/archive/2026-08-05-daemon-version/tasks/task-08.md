---
id: task-08
title: "Wire 6 runtime endpoints to _runtime_read for version fields"
title_zh: "router 6 个 runtime 端点调 _runtime_read 填充版本字段"
author: WhaleFall
created_at: 2026-08-04 11:14:15
priority: P0
depends_on:
  - task-07
blocks: []
requirement_ids:
  - FR-01
decision_ids:
  - D-004@v1
allowed_paths:
  - backend/app/modules/daemon/router.py
related_tests:
  - backend/tests/modules/daemon/test_runtime_router.py
expects_from:
  - source: task-07
    contract: RuntimeWithInstance
    needs:
      - runtime
      - daemon_instance
goal: >
  把 daemon runtime 的 6 个端点（list / read / update / disable / enable / offline）
  从裸 DaemonRuntimeRead.model_validate(runtime) 改为统一调用
  _runtime_read(runtime, owner, instance)，复用 :442-463 现有模式，由
  model_copy(update=) 填 daemon_version / daemon_build_id，使 DTO 这两个字段
  不再恒 null，契约对齐 FR-01 与 D-004@v1。
implementation: |
  前置：task-07 已把 6 处 service 方法改为返回 (runtime, instance) tuple，
  instance 可为 None（迁移期 daemon_instance_id 可空）。
  逐端点改写（文件 backend/app/modules/daemon/router.py）：
    1. list_runtimes（:934-946）：解构 service.list_runtimes 返回的
       list[tuple[DaemonRuntime, DaemonInstance|None]]，逐项调
       _runtime_read(runtime, None, instance)。
    2. read（:567 / get_runtime :810-817）：service.get_runtime 改返
       (runtime, instance) | None，None 时仍抛 DaemonRuntimeNotFound；
       非空时 _runtime_read(runtime, None, instance)。
    3. update（:817 区段 update_runtime 路径 :560-567）：解构 service.update_runtime
       返回 tuple，调 _runtime_read(runtime, None, instance)。
    4. disable（:834）：解构 service.disable_runtime 返回 tuple，调 _runtime_read。
    5. enable（:851）：解构 service.enable_runtime 返回 tuple，调 _runtime_read。
    6. offline（:885）：解构 service.mark_offline 返回 tuple，调 _runtime_read。
  约束：
    - 不再出现裸 DaemonRuntimeRead.model_validate(runtime)（6 处全替换）。
    - owner 入参留 None（这 6 个端点未带 owner 行；OwnerRead 由别处填充）；
      _runtime_read 在 owner=None 时跳过 owner 分支，不影响。
    - instance=None 守卫已由 _runtime_read :461-463 处理（update 空时原样返回）。
    - 不改 _runtime_read 签名；不改 schema / response_model。
acceptance: |
  - 6 个端点返回体中 daemon_version / daemon_build_id 在 instance 非空时
    等于 daemon_instances.version / build_id。
  - instance=None（旧 daemon / 迁移期）两字段为 null，行为向后兼容。
  - grep 'DaemonRuntimeRead.model_validate' 在 router.py 内 0 命中（除
    _runtime_read 自身内部 :450 一处）。
  - response_model 不变（DaemonRuntimeRead / list[DaemonRuntimeRead]）。
verify: |
  - pytest backend/tests/modules/daemon/test_runtime_router.py
  - curl 6 个端点断言 daemon_version / daemon_build_id 非空（含 instance 场景）。
  - grep -n 'DaemonRuntimeRead.model_validate' backend/app/modules/daemon/router.py
    仅剩 _runtime_read 内部一处。
  - 旧 daemon（instance=None）回归：两字段 null，不报错。
constraints: |
  - 仅改 router.py；service 返回结构归 task-07，schema/migration 不归本任务。
  - 不动 OwnerRead 分支（owner=None 即跳过，符合现有 :452-457 守卫）。
  - 不增减端点、不改 URL / 方法 / response_model。
  - 跨平台一致（纯 Python 序列化，无平台相关代码）。
---
