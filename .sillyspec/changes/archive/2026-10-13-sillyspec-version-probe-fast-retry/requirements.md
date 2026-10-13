---
author: flow-machine-draft
created_at: 2026-10-13T15:01:33.214Z
---
# 需求规格（Requirements）— 2026-10-13-sillyspec-version-probe-fast-retry

## 功能需求

### FR-01: SillySpecManager 新增限频重探入口 retryProbeLocalIfUnknown：version 未知（null）且距上次 probeLocal 尝试超过 120 秒才真正重探；版本已知不重探；全路径自收敛不抛异常

- SillySpecManager 必须提供公共方法 `retryProbeLocalIfUnknown(): Promise<void>`：当快照 version 为 null（未知，含注册期探测失败遗留）且距上次 `probeLocal()` 尝试时刻超过 `versionRetryMs`（默认 120_000ms）时执行一次 `probeLocal()`；version 非 null 时必须为纯 no-op（禁止任何 spawn）；限频窗口内（含从未尝试之外的场景）必须跳过重探。方法全路径必须自收敛不抛异常（探测执行异常仅记 warn 日志）。

#### 场景：版本未知且窗口已过

- Given manager 构造后 version=null，且上一次 probeLocal 尝试发生在 ≥120s 前（或注入 `versionRetryMs` 调小后的等价窗口）
- When 调用 `retryProbeLocalIfUnknown()`
- Then 内部执行一次 `sillyspec --version` 探测（runCommand 被调），成功后 `getSnapshot().version` 刷新为探测值

#### 场景：版本已知

- Given `getSnapshot().version` 非 null
- When 调用 `retryProbeLocalIfUnknown()`
- Then 不执行任何探测（runCommand 调用计数为 0）

#### 场景：限频窗口内

- Given version=null 且距上次 probeLocal 尝试 < versionRetryMs
- When 调用 `retryProbeLocalIfUnknown()`
- Then 跳过探测（runCommand 调用计数不变）

### FR-02: daemon 心跳每拍触发该入口且不阻塞心跳节奏（void 不 await，探测最坏 30 秒超时不拖心跳发送）

- `_sendHeartbeatOnce` 必须在组装 sillyspec 快照前触发 `retryProbeLocalIfUnknown()`，且必须以 fire-and-forget（void 不 await）方式调用——探测最坏 30 秒超时（runCmd 杀树）不得推迟本拍心跳发送；探测成功后由下一拍心跳快照携带 version。

#### 场景：version 未知时心跳触发重探

- Given 心跳 harness 注入假 manager（version 未知），心跳循环执行一拍
- When `_sendHeartbeatOnce()` 完成
- Then 假 manager 的 `retryProbeLocalIfUnknown` 被调用过，且心跳 HTTP 调用未被其阻塞（await 链上不包含该探测）

### FR-03: 旧假 manager（无新方法）注入时心跳不崩（duck-type 守卫，对齐 getCommandResult 惯例）

- daemon 侧触发点必须做 duck-type 守卫（`typeof === 'function'`，对齐 `_sendHeartbeatOnce` 内 getCommandResult 既有惯例）：注入的 manager 缺 `retryProbeLocalIfUnknown` 方法时必须静默跳过，禁止影响心跳其余字段的上报（旧测试零回归）。

#### 场景：旧假 manager 无新方法

- Given 测试注入缺 `retryProbeLocalIfUnknown` 的假 manager
- When `_sendHeartbeatOnce()` 执行
- Then 心跳正常发送（不抛 TypeError），sillyspec 快照字段按旧语义组包

### FR-04: 注册期探测失败场景：假「未安装」在 2 分钟限频窗口过后随重探自愈，成功后下一拍心跳带上真实版本

- 注册期（`_registerDaemon`）probeLocal 失败后，必须在 120 秒限频窗口过后的首拍心跳触发重探；重探成功后，随后一拍心跳的 sillyspec 第 5 参必须携带 version（既有兄弟字段语义：version 非 null 才带键），backend `sillyspec_version` 列随之由 NULL 收敛为真实版本，机器卡「未安装」徽标自愈。

#### 场景：注册失败 → 心跳自愈链路

- Given manager 注册期 probeLocal 失败（version=null、lastAttemptAt 已记），心跳间隔 15s
- When 假钟推进 ≥120s 后心跳拍触发 `retryProbeLocalIfUnknown()` 且本次探测成功
- Then 心跳报文 body 携带 `sillyspec_version`=<真实版本>（此前拍不携带该键）

### FR-05: 重探仍失败时限频窗口重新计时，不产生每拍连发探测

- 重探执行（无论成败）必须以本次尝试时刻重置限频窗口（lastAttemptAt 在 probeLocal 内统一记账）；重探连续失败时必须保持每 versionRetryMs 至多一次探测的节奏，禁止每拍/每秒连发 spawn。

#### 场景：连续失败不连发

- Given version=null 且重探持续失败（runCommand 返回 null）
- When 在一个限频窗口内连续调用 `retryProbeLocalIfUnknown()` 多次
- Then 仅窗口过期后的第一次调用触发真实探测，其余全部跳过（探测调用次数=窗口过期次数）

### FR-06: 新增单测覆盖上述分支，相关既有测试（sillyspec-manager / daemon-heartbeat-sillyspec）不回归

- 新增单测必须覆盖 FR-01~FR-05 各分支（已知不探/窗口内跳过/窗口外重探/失败重计时/daemon 触发与守卫），且必须保证 `sillyspec-manager.test.ts` 与 `daemon-heartbeat-sillyspec.test.ts` 全部既有用例不回归；跑法限定 `vitest run` 这两个文件 + `tsc --noEmit`（typecheck）。

#### 场景：测试面

- Given 本变更合入后
- When 在 sillyhub-daemon 目录跑 `vitest run tests/sillyspec-manager.test.ts tests/daemon-heartbeat-sillyspec.test.ts` 与 `pnpm typecheck`
- Then 全部通过（exit 0）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/sillyspec-manager.test.ts「retryProbeLocalIfUnknown：版本未知+窗口已过 → 执行探测并刷新快照」/「版本已知 → 纯 no-op 不探测」/「限频窗口内 → 跳过探测」
FR-02: test/daemon-heartbeat-sillyspec.test.ts「心跳触发 version 未知限频重探（void 不阻塞心跳）」
FR-03: test/daemon-heartbeat-sillyspec.test.ts「旧假 manager 缺 retryProbeLocalIfUnknown → 心跳不崩按旧语义组包」
FR-04: test/sillyspec-manager.test.ts「注册失败后窗口过期重探成功 → 下一拍心跳携带 version」（与 daemon 层键存在性既有用例组合验证）
FR-05: test/sillyspec-manager.test.ts「重探失败窗口重计时 → 一个窗口至多一次探测」
FR-06: 不适用：本条是对测试面自身的约束（跑法=两个测试文件 + typecheck 全绿），由 flow done 测试对账与上述 FR-01~05 用例共同承载
