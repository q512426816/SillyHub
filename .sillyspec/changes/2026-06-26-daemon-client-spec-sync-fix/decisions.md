---
author: qinyi
created_at: 2026-06-26 10:56:38
---

# Decisions — daemon-client workspace spec 树同步修复

重大决策与 Grill 台账。稳定 ID（D-xxx@vN），superseded 时保留历史。

## D-001@v1: 修复范围 = A+B+C+runtime 全修
- type: scope
- status: accepted
- source: user
- question: scan-docs/knowledge/runtime 全空 + changes 报错的根因分三层（A=sync 时机、B=契约、C=写通路），加上 runtime 需反转 R-02。范围怎么定？
- answer: 全修（A+B+C+runtime）打成一个变更。
- normalized_requirement: 一个变更覆盖 FR-01~FR-10；A+B 必须捆绑（否则中间态仍不可见）。
- impacts: [全 Phase, 所有 task]
- evidence: 用户需求澄清 Grill 回答（2026-06-26）

## D-002@v1: scan run 终态即回灌（保留 session-end 兜底）
- type: architecture
- status: accepted
- source: user
- question: scan run 完成后 scan-docs 何时在 backend 可见？
- answer: scan run 到终态（completed/failed）立即触发 postSpecSync；onSessionEnd 保留作兜底。
- normalized_requirement: daemon 抽 `syncSpecTreeIfNeeded`，scan 终态回调调用；apply_sync 整树覆写幂等，double-sync 无害。
- impacts: [task-09, task-10, FR-05, FR-07]
- evidence: 用户需求澄清回答；daemon.ts onSessionEnd:1422-1446

## D-003@v1: .runtime 纳入 push 同步（pull 仍排除）
- type: architecture
- status: accepted
- source: code + user
- question: `/runtime` 读 spec_root/.sillyspec/.runtime/sillyspec.db，而 .runtime 被 sync 按设计 R-02 排除。如何让 runtime 可见？
- answer: 非对称——build_bundle（pull）继续排除 .runtime（backend 的非权威，不污染 daemon）；apply_sync（push）+ daemon packSpecDir 改为包含 .runtime（daemon 是 daemon-client 唯一 sillyspec 执行方，权威）。
- normalized_requirement: packSpecDir 不再排除 .runtime；apply_sync 接收 .runtime 覆盖；runtime/service 走 platform_managed mode 读 .runtime/sillyspec.db。
- impacts: [task-11, task-12, task-03, FR-06]
- evidence: spec-sync.ts:144-145（packSpecDir 排除）；spec_workspace/service.py:276（build_bundle 排除）；spec_workspace/service.py:344-348（apply_sync preserve）

## D-004@v1: daemon 代写 change 经 lease-polling（daemon 无 HTTP server）
- type: architecture
- status: accepted
- source: code
- question: backend 如何把 change-write 命令送达 daemon？（原假设 session WS 通道）
- answer: daemon 不暴露 HTTP server，无推送通道；唯一命令通道是 lease 轮询（daemon GET pending-leases→claim）。change-write 经新 `daemon_change_writes` 任务队列，daemon 轮询 claim→本地写→postSpecSync 回执。不新增 daemon server，不 piggyback session 消息通道（session 只跑 agent 消息）。
- normalized_requirement: 新表 daemon_change_writes（或 daemon_task_leases.kind='change-write'）；daemon task-runner 轻量分支（不启 agent）；backend pending-change-writes + claim/complete 端点。
- impacts: [task-14, task-15, task-16, task-17, FR-08, FR-10]
- evidence: daemon/router.py:1393（pending-leases 轮询）；daemon 无 createServer/listen（grep 核实）

## D-005@v1: SpecPathResolver platform_managed mode（方案 A：backend 读端适配）
- type: architecture
- status: accepted
- source: user
- question: .sillyspec 包裹层契约怎么对齐？（方案 A backend 读端适配 / 方案 B daemon 加包裹 / 方案 C 边界翻译）
- answer: 方案 A——backend SpecPathResolver 增 platform_managed mode，platform-managed spec_root 即 .sillyspec 内容根（扁平）。daemon 本地布局不动、无数据迁移、server-local 零回归（mode 默认 False）。方案 B（daemon 大改+迁移）与方案 C（边界翻译技术债）否决。
- normalized_requirement: SpecPathResolver(root, *, platform_managed=False)；for_spec_workspace(spec_ws) 工厂按 strategy 选 mode；全 reader 走工厂。
- impacts: [task-01~task-08, FR-01~FR-04]
- evidence: 用户方案选择；scan_docs/parser.py:105 / runtime/service.py:50 / validator.py 硬编码 .sillyspec
