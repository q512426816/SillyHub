---
id: task-07
title: "markPendingSwitch + pendingSwitch 状态 + _onResult 检测触发 reload"
title_zh: "markPendingSwitch 加 pendingSwitch 状态加 _onResult 检测触发 reload"
author: WhaleFall
created_at: "2026-08-06 16:40:41"
priority: P0
depends_on: [task-06]
blocks: [task-08]
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
goal: >
  session-manager 新增 pendingSwitch 状态加 markPendingSwitch 方法(空闲立即 reload 加生成中标记)
  加 _onResult 在 turn 完成收尾时检测到 pendingSwitch 则触发 reload(实现 D-002@v1 等 turn 边界语义)。
implementation:
  - types.ts SessionState 新增 pendingSwitch 可选字段, 结构 { providerConfig: ProviderConfig | null }(停止场景为 null, 仅内存态不落盘)。
  - 新增 markPendingSwitch(sessionId, providerConfig) 方法, session 空闲(state.currentRunId 为空 且 status==='active')立即调 this.reloadWithProvider, 否则覆盖写 state.pendingSwitch 不中断当前 turn。
  - _onResult 在 turn 收尾(status 切 active 加 currentRunId 清空 之后)检测 state.pendingSwitch 非空, 取出 providerConfig 后清标记并调 this.reloadWithProvider。
  - pendingSwitch 标记由本 task 在 SessionState 声明并读写, reloadWithProvider 方法体由 task-08 实现, 本 task 仅在调用点 forward 引用(可留 task-08 覆盖的 stub 签名让 tsc 通过)。
acceptance:
  - 空闲 session(status=active 且无 currentRunId)收到切换立即触发 reloadWithProvider, 不写 pendingSwitch 标记。
  - 生成中 session(status=running)收到切换仅覆盖写 state.pendingSwitch, 当前 turn 不被中断。
  - _onResult 在生成中 turn 完成后检测到 pendingSwitch 非空, 清标记并触发 reloadWithProvider。
  - WS 重放同一切换(pendingSwitch 已设)覆盖写不累积, 幂等安全。
verify:
  - cd sillyhub-daemon 加 pnpm test 全绿(含新增 markPendingSwitch 三分支与 _onResult 检测触发 reload 用例)。
  - pnpm tsc --noEmit 类型零错误(reloadWithProvider forward 引用可解析)。
constraints:
  - pendingSwitch 覆盖写幂等(WS 重放安全, 重放只覆盖不累积)。
  - 严格不中断生成中 turn, reload 时机由 _onResult 的 turn 边界决定(D-002@v1)。
  - reloadWithProvider 方法体由 task-08 实现, 本 task 仅在 markPendingSwitch 与 _onResult 调用点 forward 引用, 不写 reload 主体逻辑。
  - pendingSwitch 仅存内存 SessionState, 不进 snapshotPersistable 白名单(禁止落盘, daemon 重启由 lease/claim 重注默认, 不恢复 pendingSwitch)。
provides:
  - contract: markPendingSwitch
    fields: [方法]
  - contract: pendingSwitch state
    fields: [SessionState 字段]
---
