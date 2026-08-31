---
id: task-05
title: 'daemon 接线——config `sillyspec_update_interval_sec`（+config.test.ts 键表 29→30）+ protocol.ts SILLYSPEC_UPDATE（+TS 契约镜像测试与 MSG 计数 21→22）+ `_sillyspecLoop` 第四循环 + hub-client register/heartbeat 可选参 + daemon.ts 心跳/注册透传 + `_handleMessage` case + 心跳 body 键存在性单测（depends_on: task-04）'
title_zh: 'daemon 接线——config `sillyspec_update_interval_sec`（+config.test.ts 键表 29→30）+ protocol.ts SILLYSPEC_UPDATE（+TS 契约镜像测试与 MSG 计数 21→22）+ `_sillyspecLoop` 第四循环 + hub-client register/heartbeat 可选参 + daemon.ts 心跳/注册透传 + `_handleMessage` case + 心跳 body 键存在性单测（depends_on: task-04）'
author: 'qinyi'
created_at: 2026-08-31 08:31:16
priority: P0
depends_on: [task-04]
blocks: [task-08]
requirement_ids: [FR-04, FR-05, NFR-01]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/config.ts
  - sillyhub-daemon/src/protocol.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/config.test.ts
  - sillyhub-daemon/tests/protocol-session-contract.test.ts
  - sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts
goal: >
  把 task-04 的 sillyspec-manager 接进 daemon 主干：config 间隔字段、protocol 新消息、第四自动循环、
  hub-client register/heartbeat 可选 sillyspec 参数（键存在性语义）、WS case、三类既有测试更新 + 新心跳单测。
implementation:
  - config.ts 加 sillyspec_update_interval_sec（default 3600，0=关，形状对齐 self_reload_check_interval_sec）；config.test.ts DEFAULT_CONFIG 键数组有序插入新键（29→30）
  - protocol.ts MSG 加 SILLYSPEC_UPDATE: 'daemon:sillyspec_update'（与 backend DAEMON_MSG_SILLYSPEC_UPDATE 逐字对齐）+ MsgType 联合；protocol-session-contract.test.ts EXPECTED map 加条目 + MSG 计数断言 21→22
  - hub-client.ts register() 追加可选末位参 sillyspec?: {version: string|null, latest_version: string|null}（键知道才带）；heartbeat() 追加可选末位参 sillyspec?: {version?: string|null, latest_version?: string|null, update?: SillySpecUpdateState|null}——update 仅非 null 携带（=backend 清除），version/latest 仅知道时携带（=backend 保留），注释锚定 D-002@v1；类型 SillySpecUpdateState 从 manager 导出复用
  - daemon.ts：实例化 SillySpecManager（isBusy 接 _isBusyForUpdate，runner 复用 manager 内实现）；_fire 三循环处挂第四循环 _sillyspecLoop（interval=config.sillyspec_update_interval_sec，0 跳过；每拍 checkAndUpgrade('auto')，abortableSleep 对齐现有循环写法）；_sendHeartbeatOnce 从 manager.getSnapshot() 组装 sillyspec 参数（update===undefined 时不传该键）；_registerDaemon 注册前先 probeLocal/probeLatest 一次再随 register 携带；_handleMessage 加 case MSG.SILLYSPEC_UPDATE（对齐 SELF_UPDATE :4875 写法，void manager.requestUpgrade('server_command')，日志 sillyspec_update_received）
  - 新建 tests/daemon-heartbeat-sillyspec.test.ts（仿 daemon-heartbeat-pending.test.ts）：有 update 时 body 含 sillyspec_update 三段、无 update 时键完全不出现、version/latest 缺省时键不出现、register body 携带版本
acceptance:
  - 契约镜像测试绿（字面量双侧一致，计数 22）
  - 心跳 body 键存在性四分支单测绿；config.test.ts 30 键绿
  - daemon 既有测试套件零回归（重点 daemon-heartbeat-pending / preflight / selfupdate 相关）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/protocol-session-contract.test.ts tests/daemon-heartbeat-sillyspec.test.ts tests/config.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 全部新参数追加末位可选，undefined 键不出现（既有调用 body 逐字段不变）
  - 不改 preflight runSillySpecCheck 启动门行为；不自建 npm spawn（升级只经 manager/installSillySpec）
  - WS case fire-and-forget 无回执（同 CLEANUP）；忙推迟语义由 manager 内部状态机承载，daemon.ts 不重复实现
expects_from:
  - task-04: SillySpecManagerApi（getSnapshot/requestUpgrade/checkAndUpgrade/probeLocal/probeLatest）
  - task-02: heartbeat/register sillyspec 字段契约（D-002@v1 双通道语义）
provides:
  - contract: DaemonSillySpecReporting
    fields: [heartbeat body sillyspec 字段, register body sillyspec 字段, WS SILLYSPEC_UPDATE 消费]
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
