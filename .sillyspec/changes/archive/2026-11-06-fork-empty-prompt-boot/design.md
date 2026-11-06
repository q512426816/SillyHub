---
author: flow-machine-draft
created_at: 2026-11-06T15:11:33.328Z
---
# 设计记录（Design Record）— 2026-11-06-fork-empty-prompt-boot

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两端各改一处，均为既有契约的对齐而非新机制：

1. **daemon 侧（sillyhub-daemon/src/daemon.ts `_startInteractiveSession`）**：空 prompt 守卫
   （interactive_missing_fields）增加 fork lease 豁免——判定特征用 claim payload 的
   `forkSession === true`（backend placement.py 对 fork lease 恒写 `fork_session=true`
   谓词键，非 fork lease 全链无键，比 resumeSessionId 更精确：resume 链还有人格热切换/
   worker 重派等非 fork 消费方）。豁免后空 prompt 的 fork lease 正常走
   SessionManager.create（其空 firstPrompt 契约已就绪：不挂 10s 兜底、首轮由用户
   首问 inject 驱动，session-fork.test.ts 24h 审查 H-2 用例既有覆盖）。守卫仍拦的
   早退分支顺带补 notifyRunResult 回报（P2b 同款）——修复生产事故中「认领后裸
   return 不回报，run 挂 5 分钟等 300s 僵尸轮清扫」的放大器。
2. **backend 侧（create.py `create_session` 加 `inherited_cwd` 参数 + fork.py 传
   `source.cwd`）**：workspace 派生链（inject_gates 仅 workspace_id 在场时落
   cwd=ws.root_path）覆盖不到「源会话 cwd 有值但无 workspace」形态（如 platform
   会话），此类形态 fork 出的 B 丢 cwd → 断线恢复后 reopen 409 死路（生产事故
   0aa54089 父子双双命中）。兜底仅在派生值为 None 时生效（派生优先，不打架）；
   源 cwd 本就 None 则透传 None 不伪造——非工作区默认目录分配归
   2026-11-06-session-reopen-no-cwd 根治方向，本变更不越界造值。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

### 文件变更清单（提交面自声明）

- `sillyhub-daemon/src/daemon.ts` — `_startInteractiveSession` 空 prompt 守卫 fork 豁免 + 早退回报
- `sillyhub-daemon/tests/session-fork.test.ts` — 守卫豁免/防回归两用例 + mock client 补 notifyRunResult
- `backend/app/modules/daemon/session/service/create.py` — `create_session` 新增 `inherited_cwd` 参数与兜底
- `backend/app/modules/daemon/session/service/fork.py` — fork 调 create 链透传 `inherited_cwd=source.cwd`
- `backend/app/modules/daemon/tests/test_session_fork.py` — `TestForkCwdInheritance` 三形态用例

- `create_session`（backend session service）新增可选参数 `inherited_cwd: str | None = None`：
  仅内部调用方（fork.py）使用，HTTP API 无变化；缺省 None 时存量调用行为逐字节不变。
- `fork_session`（backend fork.py）调 create 链时透传 `inherited_cwd=source.cwd`。
- daemon `_startInteractiveSession` 守卫条件由 `!prompt` 收窄为
  `!prompt && forkSession !== true`；早退分支新增 `notifyRunResult(status=
  error_during_execution)` 回报（无 claimToken/runId 时仍只 log）。对 backend ↔
  daemon 的 wire 协议零变化（fork_session 键既有）。
- AgentSession.cwd 列、lease metadata、claim payload 均无格式变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. **乱序/迟到到达**：WS 重放/重复 task_available 由既有 `_interactiveSessions
   ByLease` 判重（AC-09）先行短路，守卫豁免不改变判重时序；空 prompt fork lease
   的首轮输入由用户后续 inject 驱动（SESSION_INJECT 既有链），无乱序敏感面。
2. **并发写**：单 daemon 进程内 `_startInteractiveSession` 每 lease 至多执行一次
   （判重短路）；B 会话与源会话 A 的 SDK 会话 id 不同（forkSession=true 时 SDK
   fork 出新 id），无共享写目标。backend 侧 inherited_cwd 只影响 B 行 INSERT
   初值，无并发覆写面。
3. **切换/生命周期**：守卫早退若 notifyRunResult 失败仅 warn（best-effort，
   P2b 同款），run 兜底收敛仍由 backend 300s 僵尸轮清扫兜住——回归到既有安全网
   而非新增失败面；fork lease 建会话失败走 create catch 既有回报（P2b 路径）。
4. **作用域**：inherited_cwd 取自源会话行（同 user 归属已校验 404），不跨用户；
   fork B 的 workspace/cwd/runtime 三者同源于 A，多实例/多机无串台面（B 钉定
   源 runtime 既有机制不变）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：**豁免面过宽**——若未来出现「非 fork 场景但 forkSession 键误携带 true」
的 lease，会以空 prompt 建出无首轮的引擎会话。缓解：forkSession 谓词键的唯一
写入点是 placement.py 的 fork 分支（fork_mode 真值才写），claim payload 白名单
单源；测试 FR-02 守护非 fork 空 prompt 仍早退。放弃的方案：a) 按
`resumeSessionId` 非空豁免——resume 链还有人格热切换/worker 重派等非 fork 消费方，
特征不精确，弃；b) daemon 侧对空 prompt lease 主动注入一条占位首句——与
「native fork 首轮即用户首问」设计契约（24h 审查 H-2）冲突且污染 B 时间线，弃；
c) 给非工作区 fork 会话伪造默认 cwd——越界（reopen-no-cwd 变更的根治面），弃。
