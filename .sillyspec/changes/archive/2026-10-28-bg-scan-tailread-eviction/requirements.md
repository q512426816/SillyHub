---
author: flow-machine-draft
created_at: 2026-10-27T23:44:45.002Z
---
# 需求规格（Requirements）— 2026-10-28-bg-scan-tailread-eviction

## 功能需求

### FR-01: _bgTaskFinalLoop 读日志改为 open+read 按区间读最后 64KB（文件小于窗口时整读），不再 readFile 全量进内存；读失败仍走既有 continue 下轮再看

- 必须把扫描环读日志实现改为 `open()` 句柄 + `read()` 按字节区间读（对齐 liveness/tailer.ts 既有实践）：只把文件末尾至多 64KB 读入内存；文件小于窗口时整读；禁止 `readFile` 全量读入后切片。读失败（文件消失/IO 错误）必须保持既有语义：本轮 `continue` 下轮再看、不得使扫描环抛出或中断。

#### 场景：大日志只读尾窗

Given 一个远大于 64KB 的 claude-code 日志
When 扫描环读取尾段
Then 仅末尾 64KB 字节进入内存（句柄 try/finally 关闭），提取逻辑与现状逐字等价

### FR-02: _bgTaskSnapshots 每轮按本轮 targets 可见集核对淘汰不再产出的 logPath（非空内层 Map 也可淘汰），消除只增不减

- 必须把现「仅删空内层 Map」的无效清理改为：每轮扫描结束时按本轮 discoverLivenessWatchTargets 产出的可见 logPath 集核对，淘汰集合外的所有快照条目（含内层非空者）；仍在可见集中的条目必须原样保留（幂等基线不丢）。SHOULD 保留被淘汰计数用于 debug 观测。

#### 场景：会话结束后路径淘汰

Given 快照表含 logPath A（内层有终态条目）且本轮 targets 已不含 A（会话终态 spawn 记录移除）
When 本轮扫描结束执行淘汰
Then A 被移除；本轮仍可见的 logPath B 全部保留、B 的终态基线不重报（首扫语义不变）

### FR-03: 新增单测覆盖区间读（大于窗口取尾/小于窗口整读/文件缺失拒判）与淘汰（可见集外移除/全不可见清空/可见全保留）；daemon 相关既有测试回归零破坏

- 必须新增独立测试文件，对抽取的区间读与淘汰两个纯函数各覆盖三形态（区间读：大于窗口取尾、小于窗口整读、缺失文件拒判；淘汰：可见集外移除、全不可见清空、可见全保留）；daemon 侧涉及后台任务终态的既有测试（cdcb97fdb 引入面）回归必须零破坏。

#### 场景：区间读与淘汰单测全绿

Given 新增 sillyhub-daemon/tests/bg-task-scan.test.ts
When 运行 vitest 该文件与相关既有测试
Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/bg-task-scan.test.ts「readFileTailBytes 读大于窗口文件只取尾段」「readFileTailBytes 文件小于窗口整读」「readFileTailBytes 文件缺失拒判」
FR-02: sillyhub-daemon/tests/bg-task-scan.test.ts「evictUnseenSnapshotPaths 移除可见集外条目」「全不可见时清空」「可见集内条目全保留」
FR-03: sillyhub-daemon/tests/bg-task-scan.test.ts「全文件六用例」+ sillyhub-daemon/tests/knowledge-hits-flush.test.ts「既有回归」（daemon.ts 触及面回归）
