---
id: task-03
title: 'backend 接口层——心跳落库（null 载荷置 NULL）+ 机器视图端点透出嵌套 sillyspec_status + 单测（含既有心跳消费者回归）'
title_zh: 'backend 接口层——心跳落库（null 载荷置 NULL）+ 机器视图端点透出嵌套 sillyspec_status + 单测（含既有心跳消费者回归）'
author: 'qinyi'
created_at: 2026-09-03 08:46:57
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-05, NFR-01]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/tests/test_machine_sillyspec.py
  - backend/app/modules/daemon/tests/test_machines_router.py
  - backend/app/modules/daemon/tests/test_register_heartbeat_daemon.py
goal: >
  打通 sillyspec_status 的 backend 接口层（依赖 task-01 数据层/schema）：心跳载荷落库
  （None=清除置 NULL，语义锚定 sillyspec_update 权威注释）+ 机器视图端点嵌套透出，
  补 null 置 NULL 用例与既有心跳消费者回归用例，为 task-05 gen:types 提供可再生产的
  OpenAPI 输入。
implementation:
  - router.py daemon_heartbeat（L469-514 sillyspec_update 接线先例）——DaemonHeartbeatRequest
    追加 sillyspec_status 字段（Pydantic 模型用 task-01 的 schema；若 task-01 按 task-07
    inline DTO 惯例就近放 router 则跟随其放置），handler 传
    sillyspec_status=data.sillyspec_status.model_dump() if data.sillyspec_status is not None
    else None 到 RuntimeService.heartbeat_daemon（同 L513-514 形态）
  - runtime/service.py heartbeat_daemon（L355-505 sillyspec_update 落库段先例）加
    sillyspec_status 形参——None 时 instance.sillyspec_status = None（清除，锚定 L482-486
    权威语义）；非 None 时 dict 整包直写（progress 快照非状态机，无 since/upsert 概念）；
    register_daemon 的 sillyspec_update 恒清块（L261）就近同步 sillyspec_status=None
    （快照随 daemon 进程重启失效，同 sillyspec_update 重启收敛理由）
  - service.py DaemonService.heartbeat_daemon facade（L185-205）同步透传新形参
  - router.py 机器视图——DaemonMachineReadWithPending（L647-659）追加 sillyspec_status
    嵌套字段（读取模型用 task-01 的；若按 MachineSillySpecUpdateRead L626 就近先例则本卡
    就近建）；_build_machine_read（L716-770）显式逐字段构造——该函数不走 model_validate，
    漏传即静默丢字段（2026-08-31 Design Grill F2 教训）
  - test_machine_sillyspec.py 扩展（仿本文件 sillyspec_update 既有用例形态）——服务层直调
    与 HTTP 全链路两形态：心跳带 dict 落库 JSON 原样、显式 null 置 NULL、缺省（旧 daemon
    无字段）路径不破坏；GET /machines items[] 含 sillyspec_status 嵌套形态（上报机/NULL 机
    双断言）；app.openapi() 直出含 DaemonMachineReadWithPending.sillyspec_status 字段
    （task-05 gen:types 输入可再生产，范式照本文件既有 OpenAPI 用例）
  - 既有心跳消费者回归（NFR-01）——test_register_heartbeat_daemon.py（心跳主路径）+
    test_machines_router.py（机器视图）既有用例全量复跑，覆盖「心跳体追加可选字段后
    Pydantic 消费零破坏」
acceptance:
  - 心跳 sillyspec_status=对象 → Machine.sillyspec_status JSON 原样落库（服务层直调 +
    HTTP 全链路两用例，字段不经服务层增删改写）
  - 心跳显式 null / 缺省字段 → 置 NULL（None=清除语义，与 sillyspec_update 一致；刻意区别于
    sillyspec_version/latest 兄弟字段的「缺省保留」）；register 后快照清除
  - GET /machines items[] 含 sillyspec_status（嵌套类型化形态，NULL 机为 null）；OpenAPI
    schema 含 DaemonMachineReadWithPending.sillyspec_status（gen:types 可再生）
  - 既有 test_register_heartbeat_daemon.py / test_machines_router.py / test_machine_sillyspec.py
    既有用例零回归（既有心跳消费者不受新增可选字段影响，NFR-01）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_machine_sillyspec.py app/modules/daemon/tests/test_machines_router.py app/modules/daemon/tests/test_register_heartbeat_daemon.py -q --no-cov
  - cd backend && uv run ruff check app/modules/daemon && uv run mypy app/modules/daemon
constraints:
  - 不改 model.py / migrations / schema.py 数据层与 Pydantic 模型本体（task-01 拥有）；
    本卡只做接线（router handler + service 形参 + 视图组装）
  - 落库语义严格锚定 None=清除（router.py L307-310 / model.py L106-110 权威注释同构），
    勿照搬 sillyspec_version/latest 的「缺省保留」兄弟语义
  - 不动 ws_hub / protocol（无新事件，复用既有 heartbeat 通道）；openapi.json 再生成归
    task-05（FR-07）
expects_from:
  - task-01: Machine.sillyspec_status JSON 列 + 心跳载荷 sillyspec_status Pydantic 模型 + 机器视图嵌套读取模型（schema.py，None=清除语义注释）
provides:
  - contract: MachineSillySpecStatusView
    fields: [sillyspec_status]
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
