---
author: flow-machine-draft
created_at: 2026-10-21T03:38:36.353Z
---
# 需求规格（Requirements）— 2026-10-21-daemon-sync-hardening

## 功能需求

### FR-01: daemon spec 自动推送支持整机关闭（env）与按工作区关闭（flag 文件），关闭态为 no-op（返回 null、不动 pending_push），knowledge hits 上行不受影响

- daemon 侧 spec 推送入口（postSpecSync 包装器）必须在每次推送前检查关闭开关：机器级 env `SILLYHUB_DAEMON_SPEC_SYNC_OFF`（'1'/'true'，大小写不敏感，视为关闭推送）或工作区级 flag 文件 `~/.sillyhub/daemon/spec-sync-off/{wsId}.flag` 存在，任一命中即必须跳过推送（单写者让位 CLI `sillyspec platform sync`）。
- 关闭态必须等价 mock 语义：返回 null（调用方既有 null 分支天然 no-op）、禁止写或清 pending_push 标记（关闭是运维决策非传输失败）；knowledge hits 上行独立于 spec manifest，必须照常 best-effort 执行（防复现 2026-09-25 runbook 的「命中一行都上不去」连带面）。
- 开关命中时必须输出一次可见 warn 日志，含 workspaceId、开关来源与恢复方法（删 env / 删 flag 文件路径）。

#### 场景：env 整机关闭

Given `SILLYHUB_DAEMON_SPEC_SYNC_OFF=1` 且 mock client 的 postSpecSync 为 spy，When 调 `postSpecSync(client, wsId, specRoot)`，Then 返回 null 且 client.postSpecSync 未被调用（零网络请求）。

#### 场景：按工作区 flag 关闭

Given 仅 `~/.sillyhub/daemon/spec-sync-off/{wsId}.flag` 在位（env 未设），When 该 ws 调 postSpecSync，Then 返回 null；未设 flag 的其他 ws 不受影响（正常走推送路径）。

#### 场景：pending_push 不动

Given 关闭态命中且 specRoot/.runtime/pending_push 标记已存在，When 推送被跳过，Then 标记文件保持原样（不写不清）。

### FR-02: status 采集超时支持 SILLYHUB_DAEMON_STATUS_TIMEOUT_MS env 覆盖

- 未显式注入 `deps.statusTimeoutMs` 时，progress 采集超时必须读 env `SILLYHUB_DAEMON_STATUS_TIMEOUT_MS`：正整数毫秒必须生效；env 缺席/空白/非数字/≤0 必须回退默认 30_000；deps 显式注入的优先级必须高于 env（既有测试注入面不被破坏）。

#### 场景：env 合法生效

Given env=120000 且构造 manager 未注入 deps.statusTimeoutMs，When 执行一轮采集，Then 传给执行器的 timeoutMs 为 120000。

#### 场景：非法回退默认

Given env 为 'abc'、'-1'、'0' 或空白，When 构造 manager，Then 采集超时为默认 30_000。

### FR-03: status 采集对连续失败目标自动退避降频，成功即复位

- 同一采集目标连续失败（超时/非零退出/spawn 错误，即三态③）达 3 次后，采集必须进入退避：全局轮次每 10 轮只实采 1 轮（round % 10 === 0 实采），其余轮次必须跳过 spawn（仅 debug 日志）；任一次实采成功必须清零该目标连败计数；首次进入退避必须 warn 一次（`sillyspec_status_backoff_entered`，不得逐轮重复）；既有心跳语义不变——③失败保留上次快照、`sillyspec_status_error` 上报口径不动。

#### 场景：连败退避降频

Given 某目标连败 3 次，When 第 4~9 轮采集，Then 跳过 spawn；第 10 轮恢复实采尝试。

#### 场景：成功复位

Given 目标已处退避态且某轮实采成功，When 之后再次失败，Then 连败从 1 重新计数（不立即退避）。

### FR-04: 登记根带 .git/sillyspec-crossrepo.json 的工作区采集自动跳过并一次性提示

- 采集单目标前发现 `<cwd>/.git/sillyspec-crossrepo.json` 存在时，必须跳过该目标的 spawn（CLI uninit 门必拒、采集恒 exit 2 纯刷屏），按 info 一次性记录跳过原因与标记内 `workspace` 指路（同 cwd 不得重复输出）；该跳过禁止记为采集失败（不置位 anyFailed、不动 `_statusError`）；具名工作区（workspaceId 非 null）的滞留摘要槽必须移除。

#### 场景：跨仓跳过一次性指路

Given cwd 带 crossrepo 标记（内含 workspace 字段），When 连续多轮采集，Then 不 spawn、info 指路日志只出现一次、不产生失败账。

#### 场景：标记删除后恢复

Given 某轮标记已被删除，When 下一轮采集，Then 恢复正常 spawn 路径。

### FR-05: hub-client 全部 fetch 带显式 AbortSignal 超时

- `sillyhub-daemon/src/hub-client.ts` 内所有 `fetch(` 调用必须携带显式 `signal: AbortSignal.timeout(...)`；本变更必须补齐现存唯一缺口 fetchMcpWhitelist（用 DEFAULT_TIMEOUT_MS）；源码面断言测试必须钉住「新增无 signal 的 fetch 即红」，防止回归。

#### 场景：源码面全量断言

Given hub-client.ts 全文，When 扫描全部 fetch( 调用点，Then 每一处调用的实参块内均含 signal。

### FR-06: daemon 具备事件循环 lag 周期监控，超阈值留 warn 证据

- daemon 必须以独立循环（默认间隔 60s、可注入）周期采样事件循环延迟直方图（perf_hooks.monitorEventLoopDelay）：窗口最大 lag ≥ 5s（可注入）时必须输出 warn `event_loop_lag`（含 window_ms/threshold_ms/max_ms/mean_ms/p99_ms），为宿主冻结类事故留本端证据；正常窗口仅 debug；循环必须纳入 daemon `_fire` 统一 abort 生命周期，退出时 disable 直方图。

#### 场景：超阈值告警

Given 注入假直方图窗口 max=6000ms、阈值 5000ms，When 一拍采样，Then 输出 warn event_loop_lag 且统计字段齐全。

#### 场景：正常窗口静默

Given 假直方图 max=100ms，When 一拍采样，Then 不输出 warn（仅 debug tick）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/spec-sync-off-switch.test.ts「env 整机关闭返回 null 且零请求」「flag 按工作区关闭他 ws 不受影响」「关闭态 pending_push 不动」「parseSpecSyncOffEnv 大小写与脏值」
FR-02: sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「env 合法覆盖采集超时」「env 非法回退默认 30s」「deps 注入优先于 env」
FR-03: sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「连败 3 次进入退避降频」「退避轮取模实采」「成功复位重计」「首次进退避 warn 一次」
FR-04: sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「crossrepo 标记跳过 spawn 且一次性指路」「跳过不记失败」「标记删除恢复采集」
FR-05: sillyhub-daemon/tests/hub-client-fetch-timeout-surface.test.ts「hub-client 全部 fetch 带 signal」
FR-06: sillyhub-daemon/tests/event-loop-watch.test.ts「超阈值 warn 携带统计字段」「正常窗口静默」「循环退出 disable 直方图」
