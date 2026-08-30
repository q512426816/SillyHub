---
id: task-05
title: 'Extract _recoverSessionsOnBoot into parameterized _recoverPersistedSessions(trigger), zero boot behavior change'
title_zh: '_recoverSessionsOnBoot 参数化提取为 _recoverPersistedSessions(trigger)（boot 行为零变化）'
author: 'qinyi'
created_at: 2026-08-30 17:45:33
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
goal: >
  把 boot 恢复链主体参数化提取出来，为 task-06 的心跳触发复用做准备：
  _recoverSessionsOnBoot（daemon.ts:2348，主体 2348-2436）提取为
  _recoverPersistedSessions(trigger: 'boot' | 'heartbeat_recover')，boot 调用点
  （daemon.ts:1583）改传 'boot'，session_recover_start/done 日志增 trigger 字段
  ——本卡只做重命名+参数化+日志字段，boot 路径行为零变化（plan Wave2）。
implementation:
  - "签名提取：daemon.ts:2348 `private async _recoverSessionsOnBoot(): Promise<void>` 改为 `private async _recoverPersistedSessions(trigger: 'boot' | 'heartbeat_recover'): Promise<void>`，主体 2348-2436（超龄剔除 _recoveryRecordExpired / 并发限流 runOne / flush / _persistPendingRecoveryRecords 收尾）原样搬移，不改任何控制流与判定"
  - "boot 调用点：daemon.ts:1583 `await this._recoverSessionsOnBoot()` 改为 `await this._recoverPersistedSessions('boot')`，调用位置不动（三循环启动前、register 之后）"
  - "日志增字段：session_recover_start（2390）与 session_recover_done（2382 早退分支、2430 正常分支）各加 trigger 字段，boot 时值为 'boot'，便于生产区分恢复来源；其余日志事件（session_recover_load_failed / no_records / record_expired 等）不动"
  - "同步修正 daemon.ts 内指名旧方法的注释（1579-1582 编排注释、1666、2348 文档注释）为新名；cli.ts:627 / hub-client.ts:1317 / api-types.ts:4458 的旧名引用是叙述性注释且不在 allowed_paths，不改（api-types.ts 为后端生成物禁手改）"
acceptance:
  - "boot 行为零变化：tests/interactive/daemon-recovery-boot.test.ts 全绿（「Daemon 启动恢复编排」153 行起 +「task-08：恢复健壮性」394 行起两套 describe，含网络失败保留重试与超龄清理）"
  - "session_recover_start/session_recover_done 日志携带 trigger 字段；恢复/flush/超龄清理逻辑与提取前逐行等价（diff 仅签名、调用点、日志字段三处）"
  - "daemon.ts 内 grep _recoverSessionsOnBoot 无残留定义与调用"
verify:
  - 'cd sillyhub-daemon && pnpm typecheck'
  - 'cd sillyhub-daemon && pnpm exec vitest run tests/interactive/daemon-recovery-boot.test.ts'
  - 'grep -n "_recoverSessionsOnBoot" sillyhub-daemon/src/daemon.ts （期望 0 命中）'
constraints:
  - "本卡零新增行为：不新增 _recoverInFlight / _recoverPendingAfterDegraded / _maybeRecoverAfterDegraded、不碰 _sendHeartbeatOnce（全部归 task-06）；trigger 联合类型一次落齐 'boot' | 'heartbeat_recover'（task-06 直接消费）"
  - "ESM：import 一律带 .js 后缀（先例 daemon.ts:109 `from './preflight.js'`）"
  - "禁止跑全量测试（pnpm test / vitest run 无参），仅跑 verify 枚举文件，全量留给 CI"
  - "兼容 Windows/Linux/macOS：不引入平台特定 API，路径操作沿用现有 node:path/join"
  - "只动 allowed_paths 内文件，不碰 preflight.ts（Wave 铁律：daemon.ts 由 task-05→06→07 串行）"
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
