---
author: qinyi
created_at: 2026-10-10T15:38:00+08:00
---

# 决策记录（Decisions）— 2026-10-10-borrow-sandbox-workspace-context

## D-001@v1: 借用沙箱感知深度 = 元信息 + 真实路径只读
- type: boundary
- priority: P0
- status: confirmed（用户 AskUserQuestion 实答选定「元信息 + 真实路径只读（推荐）」）
- source: user
- question: workspace 级分享的借用沙箱会话，工作区上下文感知做到什么深度？
- answer: 注入工作区名称/描述/repo 地址/分支/技术栈 + lender 机器上真实代码目录
  路径（可读）。agent 可直接读真实源码回答问题；写守卫（registerBorrowSandbox）
  仍然只允许写沙箱内。不做 repo 克隆进沙箱（凭证/磁盘/同步复杂度不值得）。
- normalized_requirement: 沙箱上下文文件必须包含工作区元信息字段与真实
  root_path；不承诺任何写权限放开；不引入 repo clone。
- impacts: [FR-01, FR-02]
- evidence: 用户实答（2026-10-10）；写守卫现状 write-guard.ts registerBorrowSandbox
  （只拦写不拦读）；root_path 对工作区成员经 workspace API 本可见（grants 查询
  成员防御 + workspace 读权限）。

## D-002@v1: 载体 = lease 单键透传 + daemon 渲染 AGENTS.md（方案 A）
- type: design
- priority: P0
- status: confirmed
- source: architect（用户 Step3 拍板方向后权衡，Step4 记录）
- question: 上下文数据如何从 backend 到达借用 agent？
- answer: backend 在借用标记单 choke point（_stamp_borrow_sandbox_metadata 三
  调用点）查询 Workspace 行写入 metadata.borrow_workspace_context 单键（JSON
  对象）；context.py build_claim_payload interactive 分支白名单透传；daemon
  归一化处双读（camel/snake）borrowWorkspaceContext；marker 分支
  prepareWorkspace 成功后渲染 AGENTS.md 写入沙箱根。AGENTS.md 是跨 CLI 自动
  加载标准（Codex/ZCode/新版 Claude Code 均读），provider 无关零适配。
- rejected_alternatives:
  - 方案 B（daemon 回查平台 API 拿工作区详情）：新增以 borrower 身份调平台的
    认证语义与失败路径，违背「数据随 lease 走」既有惯例（复潮条件：未来上下文
    需要动态实时刷新且 lease 快照不可接受时再评估）。
  - 方案 C（backend 拼进首轮 prompt）：污染用户消息与审计回放，resume/replay
    语义混乱，provider 间不可移植。
- normalized_requirement: 数据流 producer=placement 查 Workspace 行 → lease
  metadata 单键 → claim payload 白名单 → daemon 归一化 → 沙箱 AGENTS.md 渲染；
  全链缺键穿透不伪造默认值。
- impacts: [FR-01, FR-03, FR-04]
- evidence: placement.py:504-512/926-934/1086-1096（三标记点 workspace_id 均
  可用）；context.py:554（cwd→root_path 透传先例）+ :962-967（白名单先例）；
  daemon.ts:9498 起归一化 cross-type 先例（workerDepth）；daemon.ts:8600-8631
  marker 分支；知识条目 patterns.md#AgentRun--DaemonTaskLease 编排流程（backend
  建租约带数据 → daemon 执行体消费，两端协同）。

## D-003@v1: 写隔离 enforcement 不动，AGENTS.md 仅纵深防御提示
- type: boundary
- priority: P0
- status: confirmed
- source: code
- question: AGENTS.md 含「真实路径可读」信息后，安全边界是否变化？
- answer: 不变。写隔离的唯一 enforcement 是 daemon 写守卫（registerBorrowSandbox
  后 _judgeWriteViaPolicyEngine 只允许落沙箱内）；读从未被拦截（daemon 以 lender
  OS 用户运行，技术上一向可读全盘，「不知道路径」只是弱隔离）。AGENTS.md 的
  「禁止写入代码区」文案是纵深防御提示，不是权限来源。间接注入面评估：上下文
  字段值来自平台 DB（借用者已是工作区成员），description 等长文本渲染时截断
  并标注为登记数据，风险可接受。
- normalized_requirement: 本变更不得改写 write-guard / PolicyEngine 任何判定
  逻辑；渲染模板固定于 daemon 侧代码，字段值仅做数据填充。
- impacts: [FR-02, FR-05]
- evidence: write-guard.ts:40-47（登记语义）+ :33-35（只允许落沙箱内）；
  daemon.ts:8614-8622（fail-open 注释「写隔离仍由 SessionManager 在登记沙箱
  后才激活」）。

## D-004@v1: 渲染 fail-open（失败仅 warn 不阻塞 session）
- type: design
- priority: P1
- status: confirmed
- source: code
- question: 沙箱上下文文件写入失败时如何处理？
- answer: try/catch 仅记 warn（borrow_sandbox_context_write_failed）继续启动
  session，对齐既有 borrow_sandbox_prepare_failed fail-open 先例（上下文是
  增强项，不阻塞借用主流程）。
- normalized_requirement: AGENTS.md 渲染/写入异常不得让 session 启动失败。
- impacts: [FR-04]
- evidence: daemon.ts:8619-8630（prepare 失败回退先例）。

## D-005@v1: 双向兼容（缺键跳过，零回归）
- type: design
- priority: P1
- status: confirmed
- source: code
- question: 新旧 backend/daemon 混布时行为？
- answer: 旧 backend → 新 daemon：claim payload 无键 → 不渲染 AGENTS.md（现状
  行为）。新 backend → 旧 daemon：metadata/claim payload 多一键，旧 daemon
  忽略。非借用 lease：borrowed 分支不进，零变化。
- normalized_requirement: 全链真值守护/缺键穿透，不伪造默认值；非借用路径
  逐字节不变。
- impacts: [FR-04, FR-05]
- evidence: context.py 既有白名单「None 不下发键」惯例（:526-529 注释）；
  daemon 归一化 undefined 穿透惯例。
