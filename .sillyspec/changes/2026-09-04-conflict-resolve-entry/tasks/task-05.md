---
id: task-05
title: 'daemon-protocol-dispatch'
title_zh: 'daemon 协议与分发（protocol.ts 常量与 payload 类型 + _handleWsMessage 两直连 case + in-flight 串行 guard）'
author: 'qinyi'
created_at: 2026-09-04 22:40:15
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/protocol.ts
  - sillyhub-daemon/src/daemon.ts
goal: >
  daemon 侧接收契约与分发骨架——protocol.ts 声明两条 MSG 常量、SillySpecResolvePayload
  与心跳结果类型 SillySpecCommandResult，daemon.ts _handleWsMessage 增两个机器级
  直连 case 并带 in-flight 串行 guard 忙拒，为 task-06 执行器与 task-07 测试铺契约。
implementation:
  - protocol.ts：MSG 词表 SILLYSPEC_UPDATE（约 protocol.ts:232）之后新增 SILLYSPEC_RESOLVE 与 SILLYSPEC_GHOST_CLEANUP 两常量（值 daemon:sillyspec_resolve 与 daemon:sillyspec_ghost_cleanup），JSDoc 注明与 backend DAEMON_MSG_* 逐字对齐、fire-and-forget 无回执、结果经心跳 sillyspec_command_result 回传
  - protocol.ts：新增 SillySpecResolvePayload 接口（change 为 string、strategy 为 keep_local 与 take_platform 下划线字面量联合）；新增心跳结果字段类型声明 SillySpecCommandResult（action/change/strategy/state/exit_code/error/executed_at 七字段全可选宽松，保活通道宁宽勿断，供 task-06 挂到 hub-client HeartbeatBody.sillyspec_command_result 与 sillyspec-manager 结果槽共用）
  - daemon.ts：_handleWsMessage 在 SILLYSPEC_UPDATE case（约 daemon.ts:5527）旁新增两个机器级直连 case（与 SELF_UPDATE/CLEANUP/SILLYSPEC_UPDATE 同路径，不进 control-dispatcher、不入 CONTROL_KIND 词表，约 protocol.ts:432）——resolve case 基本字段归一化后转发 sillyspec-manager 执行方法，ghost_cleanup case 转发无参执行方法；转发终点以最小接口约定表达（类型注解齐全、tsc 可独立编译），实际执行器由 task-06 注入实现
  - daemon.ts：仿 _cleanupInFlight（约 daemon.ts:1412）新增 sillyspec 命令 in-flight guard 字段（置位与复位归本卡）；忙时立即记 failed 结果（error 文案 another sillyspec command is running）不排队，忙判定覆盖本 guard 与 npm 升级链在跑两种情形，升级链探询与结果写入走同一最小接口约定（实现归 task-06）
acceptance:
  - 两常量字符串与 task-01 backend 侧 DAEMON_MSG_SILLYSPEC_RESOLVE 与 DAEMON_MSG_SILLYSPEC_GHOST_CLEANUP 逐字一致，daemon 前缀不漏
  - SillySpecResolvePayload 的 strategy 值域为 keep_local 与 take_platform 下划线字面量；SillySpecCommandResult 七字段全可选且字段名与 design §7 心跳结果定义一致
  - 两 case 为机器级直连分发（不经 control_commands 状态机），忙拒语义为立即记 failed 不排队；case 内除转发与 guard 骨架外无占位实现
  - task-06 未落地时 tsc --noEmit 独立编译通过
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 执行器方法本体（sillyspec-manager 的 runResolve 与 runGhostCleanup）与结果槽、心跳携带、config 超时键均归 task-06；本卡 case 内除 TODO 注释标注 task-06 接管点外不留任何占位实现
  - 不改 hub-client.ts、sillyspec-manager.ts、config.ts（task-06 范围）；HeartbeatBody 字段挂接归 task-06，本卡只在 protocol.ts 声明类型
  - strategy 到 CLI flag 的映射（keep_local 对应 --keep-local、take_platform 对应 --take-platform）归 task-06 单点实现，本卡不做映射
  - 行为测试归 task-07（case 分发、strategy 映射、忙拒用例），本卡只验编译通过
  - 不动 default 分支与既有 case；两消息不入 CONTROL_KIND 词表（design §7.5 机器级指令不走 control_commands 状态机）
expects_from:
  - task-01: SillySpecResolveCommand
    needs: [change, strategy]
  - task-01: SillySpecGhostCleanupCommand
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
