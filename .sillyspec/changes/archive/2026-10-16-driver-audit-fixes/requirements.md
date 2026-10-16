---
author: flow-machine-draft
created_at: 2026-10-15T23:50:30.651Z
---
# 需求规格（Requirements）— 2026-10-16-driver-audit-fixes

## 功能需求

### FR-01: zcode 轮次进行中调用 close 时 consume 正常收敛返回（对照 codex _finishTurnOnClose 先例），协程与清理不悬挂

- zcode 驱动必须在轮次 in-flight 期间被 close 时释放当前轮等待者并让 consume 正常收敛返回，禁止悬挂在 `await currentTurnPromise` 或输入队列 `next()` 上；close 释放的轮不得上报幽灵 turn result（终态归 close 链）。

#### 场景：主路径

- Given：zcode 会话一轮已发出 session/send 且引擎尚未回 turn_result（轮 in-flight）
- When：调用 `handle.close()`
- Then：`driver.consume(...)` 在有限时间内 resolve，期间不向 onTurnResult 上报任何该轮 result；协程与闭包可被 GC 回收。

### FR-02: zcode stdout 跨 chunk 多字节 UTF-8 有状态解码，中文内容不再产生 U+FFFD

- zcode 驱动必须对引擎 stdout 做跨 chunk 有状态 UTF-8 解码，禁止逐 chunk 独立 `toString('utf8')`；被管道 chunk 边界切开的多字节字符必须在拼接后还原为原字符。

#### 场景：主路径

- Given：一帧含中文的 JSON 协议帧被从多字节字符内部切成两段 Buffer 先后到达 stdout
- When：驱动喂入信封层分帧解析
- Then：归一化事件中的中文内容与原文字节级一致，不出现 U+FFFD 替换字符。

### FR-03: zcode close 阶梯 SIGTERM 到期后无条件升级 SIGKILL（仅以 exitCode 判活）

- zcode 驱动 close 阶梯的 SIGKILL 升级判定必须仅以 `exitCode === null`（进程确实存活）为准，禁止以 `killed` 标志（信号已发出即置位、不代表进程已终止）作为短路条件。

#### 场景：主路径

- Given：zcode 子进程收到 SIGTERM 后未退出（捕获/忽略信号，exitCode 仍 null、killed 已置 true）
- When：SIGKILL 升级计时器到期
- Then：必须发出 `kill('SIGKILL')`。

### FR-04: driver-factory 把 enableApproval/effectiveAskUserOnly 映射为 codex/pi/dsh/zcode 的 manualApproval/askUserOnly，并把 zcode 加入 sessionPermission 注入名单

- driver-factory 在审批就绪（enableApproval=true 且 resolver/wsClient 就绪）时，必须把 `spec.enableApproval`/`spec.effectiveAskUserOnly` 映射为 codex/pi/dsh/zcode 四 provider 的 `driverOpts.manualApproval`/`driverOpts.askUserOnly`，且 sessionPermission 注入名单必须包含 zcode；chat（enableApproval=false）会话维持不注入（驱动 allow-through，既有语义）。

#### 场景：主路径

- Given：manualApproval=true 的 scan 会话（provider=zcode 或 codex）
- When：create 构造 driverOpts
- Then：`opts.manualApproval === true`、`opts.askUserOnly === false`、`opts.sessionPermission.requestPermission` 为函数——驱动据此走人审桥而非恒自动放行。

### FR-05: dsh 驱动消费 stderr（诊断可见，管道不再可被子进程写满阻塞）

- dsh 驱动必须注册 stderr data 监听消费引擎诊断输出（进 console.warn 日志面），禁止只 `setEncoding` 而不启动流 flowing。

#### 场景：主路径

- Given：dsh 子进程向 stderr 写出一行诊断文本
- When：数据到达 daemon 侧管道
- Then：文本被消费并以 `[dsh-driver] stderr:` 前缀进入日志；子进程 stderr 写入不会被管道缓冲积压反向阻塞。

### FR-06: backend search.py 模块 docstring 与同步注释与当前实现（async 直调、无 DB uq 约束）一致

- search.py 的模块 docstring 与持久化同步注释必须与当前实现一致：router 为 async 直调（非 run_in_threadpool）；DB 层无唯一约束（20261016010000 已删 uq），跨进程并发无 DB 级幂等兜底，须注明单 worker 部署前提与扩容前置条件。注释禁止声明不存在的机制。

#### 场景：主路径

- Given：读者按 search.py 注释理解并发模型
- When：核对迁移 20261016010000 与 router.py 调用形态
- Then：注释描述与代码事实一一对应，无过时表述。

### FR-07: 聚焦测试全绿：daemon zcode/dsh 驱动与接线相关测试 + tsc 零错误；backend test_knowledge_search.py

- 本变更交付必须使 daemon 三个驱动/接线测试文件与六个波及面测试文件全部通过、`tsc --noEmit` 零错误、backend `test_knowledge_search.py` 全部通过。

#### 场景：主路径

- When：运行聚焦测试集（vitest 3+6 文件、pytest 1 文件）与 tsc
- Then：全部通过、零类型错误。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「轮次进行中 close → consume 收敛返回，不上报幽灵 result（旧实现永挂）」
FR-02: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「stdout 跨 chunk 多字节 UTF-8：中文字符不再被切烂成 U+FFFD」
FR-03: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「close 阶梯：SIGTERM 后到期无条件升级 SIGKILL（killed 置位不再短路）」
FR-04: sillyhub-daemon/tests/interactive/driver-factory-approval-wiring.test.ts「审批三态接线（driver-factory → codex 族 driverOpts）」四用例
FR-05: sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts「引擎 stderr 诊断行进 console.warn（流被消费，管道不再可被子进程写满阻塞）」
FR-06: 不适用：纯注释与实现一致性修正，无行为面；由 FR-07 回归（backend test_knowledge_search.py 31 用例）证明零行为变化
FR-07: sillyhub-daemon/tests/interactive/{zcode-app-server-driver,driver-factory-approval-wiring,dsh-acp-driver}.test.ts + {session-manager-permission,session-thinking-level,provider-registry,zcode-events,codex-app-server-driver-approval,dsh-acp-events}.test.ts + backend/app/modules/knowledge/tests/test_knowledge_search.py
