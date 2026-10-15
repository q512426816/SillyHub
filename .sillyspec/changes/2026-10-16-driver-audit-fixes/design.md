---
author: flow-machine-draft
created_at: 2026-10-15T23:50:30.652Z
---
# 设计记录（Design Record）— 2026-10-16-driver-audit-fixes

## 做法概述

本变更修 24h 只读风险审查的五项高/中置信发现，全部按同仓既有先例补齐而非新设计：zcode 驱动三处（close 释放轮次挂 `_finishTurnOnClose` 槽位 + 主循环改 while 手动拉取对齐 codex `codex-app-server-driver.ts` ql-20260906-004 同型；stdout 改 `StringDecoder` 有状态解码对齐 pi `LfLineFramer` ql-20260915-005；SIGKILL 升级去掉 `!killed` 短路对齐 codex 无条件升级）+ driver-factory 审批三态旗标映射（`InteractiveDriverStartOptions` 基类本就声明 manualApproval/askUserOnly 契约，persistence.ts 也一直传 enableApproval/effectiveAskUserOnly，缺的只是这一步映射）+ dsh stderr 消费 + backend search.py 注释对齐实现。

主循环从 `for await` 改 `while (!h.closing && !finalized)` + 手动 `inputIt.next()` 是 close 修复的必要部分：`terminateSession` 顺序为 driver.close() 先、queue.close() 后（lifecycle.ts），for-await 会在 `next()` 上多挂一个窗口，且 close 引发的 envelope dispose 会 reject 在途 session/send——catch 内补 closing 守卫静默收敛，终态归 close 链不报幽灵 result（codex 同款语义）。

## 接口契约

- `zcode-app-server-driver.ts`：handle 内部新增 `_finishTurnOnClose?` 槽位（codex 同名先例，非公共面）；consume 主循环结构变化对外行为不变（正常轮序/上报形态逐字段保持）；close 阶梯计时器 2s SIGTERM → 4s SIGKILL（旧实现 SIGTERM 即 2s，SIGKILL 实际不可达——新实现两级都可达）。
- `driver-factory.ts buildDriverOptions`：approvalReady 时对 codex/pi/dsh/zcode 多产出 `manualApproval: boolean`、`askUserOnly: boolean` 两键（此前恒缺省）；`sessionPermission` 注入名单 +zcode。生产行为变化：manualApproval=true 的 codex 族 scan 会话权限请求从「恒自动放行」变为「走 sessionPermission 人审桥」（对齐 driver-factory 注释与基类契约的设计意图）。
- `dsh-acp-driver.ts AcpJsonRpcConnection`：stderr 从 setEncoding-only 改为 data 消费（诊断进 `[dsh-driver] stderr:` 日志），无协议面变化。
- `backend/app/modules/knowledge/search.py`：仅注释，零行为变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   答：turn_result 早到（send 响应前）由既有「resolver 先于 send 注册」吸收，本变更不动该时序；close 与 turn 收敛竞态：slot 释放与 turn_result 到达双路都走 `finishTurn`（currentTurnResolve 置 null 幂等，先到者赢），closing 守卫保证释放路不上报。stdout 跨 chunk：StringDecoder 持有待拼接字节，任意切分边界都还原原序列；进程退出残尾由 `end` 事件冲刷（closing 后跳过）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   答：单会话 consume 单协程，主循环重写不引入新并发面；kill 阶梯两个 setTimeout 串行触发，`exitCode === null` 判活 + try/catch 吞退出竞态；driver-factory 映射是构造期单次赋值，无共享可变态。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   答：close 幂等（`h.closing` 先置位再走阶梯，二次调用直接返回）；close 后 consume 的 finally 仍执行 envelope.dispose（幂等清 pending）；stdin 常驻 error 监听兜底 destroy 后迟到写入的 EPIPE（不再依赖 cli 全局 uncaughtException 兜底）。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   答：全部改动是 per-session 驱动行为与 per-session driverOpts 构造，无跨工作区共享态；backend 仅为注释，不改并发模型——多 worker 扩容前置条件已在注释中写明（补 (workspace_id, spec_path, start_line) 唯一约束或 ON CONFLICT）。

## 风险与死路

最大风险：FR-04 让 codex 族 manualApproval=true 会话从恒自动放行变为真人审——行为面变化，若有依赖旧行为（自动放行）的存量 scan 流程会开始弹审批卡。裁决依据：driver-factory 既有注释（"manualApproval=true 时注入"）、基类契约（"driver 读取并据此决定审批行为"）、claude 路为同义行为（canUseTool 人审），三处均指明人审才是设计意图，恒 allow 是接线缺陷而非决策。已用独立测试文件钉住新契约。

试过但放弃：把 manualApproval 映射放在 approvalReady 块外（chat 也显式 false）——放弃，chat 会话 driverOpts 多两键对行为无增益（驱动 `!undefined` 与 `!false` 同真），且扩大 opts 面变更半径；维持「映射只在审批就绪面生效」最小切口。zcode 主循环曾考虑保留 for-await 仅加槽位——放弃，实测（本变更 TDD）证明 for-await 在 close 后仍挂 `next()`，必须改 while 形态才能收敛。
