---
author: flow-machine-draft
created_at: "2026-10-25T11:42:55.549Z"
---
# 设计记录（Design Record）— 2026-10-25-session-git-worktree-root

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户实证缺陷：会话内 agent 切到 sillyspec 工作树干活，指示项仍显示主仓 main。根因（线上 DB + 本机证据链）：平台所有 cwd 信号都是快照——`AgentSession.cwd` 是创建时值（恒主仓）、`platform_agent_logs.agent_cwd` 是 daemon 日志扫描的会话启动目录（1712 条日志仅 1 条且为主仓）、`worktree_leases` 表不经 sillyspec CLI 登记（该会话 change/run 查询 0 行）；agent 在 Bash 里 cd 进 worktree 是 agent 侧行为，平台无感知。唯一结构化可推导信号：sillyspec worktree 固定布局 `<工作区根>/.sillyspec/.runtime/worktrees/<change_key>/`（sillyspec 源码 src/worktree.js:7 WORKTREES_REL 常量）+ `AgentSession.current_change_id`（inject 打锚、随命令游走）→ `changes.change_key`（sillyspec change 名）。

方案：root 决策链前置「尽力而为」探测层——current_change_id → change_key → 候选路径（以**成员绑定根**为锚，daemon-client 模式每成员本机副本）→ daemon 平名 RPC `host_fs.stat` 探测候选下 `.git`（worktree 的 .git 是文件，lstat 可见——host_fs delegate probe_workspace_git_mode 同判据）→ 命中则 root=工作树、后续 git_status 照旧；miss/异常静默落回现有链（cwd → 绑定根），零现状回归。响应新增 `root_source` 四态字段；前端 root_source="worktree" 时 badge 加「工作树」可见标识（Tooltip 同步标注）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `GET /api/daemon/sessions/{session_id}/git-status` 响应新增 `root_source: Literal["worktree", "cwd", "workspace_root", "none"]`（`SessionGitStatusResponse` 加字段；no_root 空态 = "none"；探测命中 = "worktree"；cwd 链 = "cwd"；绑定根回退 = "workspace_root"）——向后兼容的加字段，旧前端忽略无损。
- `backend/app/modules/daemon/session/service/git_status.py`：root 决策链重构为 `_resolve_root` 两段式（探测层 + 现有链）；新增 `_probe_worktree` 辅助（stat RPC，异常捕获归 miss）；新增 `changes` 表 change_key 查询（`Change` ORM，`backend/app/modules/change/model.py`——经 `svc._session` 单 SELECT）。
- 探测 RPC 细节：`hub.send_rpc(daemon_id, "host_fs.stat", {"path": <候选>/.git}, timeout=5s)`——注册名 `host_fs.stat`（daemon `_registerHostFsRpcHandler` 前缀通道，git_log probe 测试 FakeHub 同名）；stat 返回 `{exists: bool}` 形态（host-fs-handler.ts stat 契约）；任何异常（离线/超时/远端错误/答非约定形状）一律视为 miss 落回（探测是增强层，不新增错误面）。
- 前端：`SessionGitStatus` 接口加 `root_source`；`SessionGitBranchBadge` root_source="worktree" 时渲染工作树标记（badge 内 ⎇ 后加 `（工作树）` 小标或独立 Tag；Tooltip 首行标注「sillyspec 工作树」）。api-types 生成物随 gen:types 重生成（frontend + sillyhub-daemon + openapi.json）。
- 零变更面：daemon 侧代码、`git_status` RPC 十四字段契约、既有 cwd→绑定根链语义、空态行为。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。探测与采集同请求内串行（先 stat 后 git_status），无乱序面；轮询间 worktree 被建/删的窗口最多延迟一个周期（≤60s）显示，与 FR-02 主变更语义一致。current_change_id 随 inject 游走——每请求现读，锚变化即探测新候选，无陈旧缓存。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   端点纯只读（session 行 + change 行 + 可选 lease 均 SELECT）；stat/git_status 均只读 RPC。worktree create/apply/cleanup 与探测并发时：目录存在性竞态下 stat 答 false/true 都安全（true 则查到的分支是当下真实态；false 落回主仓链——最坏显示主仓分支一个周期，非错误数据）。meta.json 不读（只 stat .git，避开 CLI 对 meta.json 的并发写面）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。探测在请求内完成、无状态残留；current_change_id 为 NULL（无变更上下文）直接跳过探测；change 行被删（SET NULL 语义下 current_change_id 已空，即使竞态残留 id 查不到行）→ miss 落回。探测 RPC 超时 5s 短预算（UI 路径，非关键面），不拖垮整体端点预算（git_status 30s 独立）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。候选路径以**成员绑定根**为锚（每成员本机副本），change 行按 session.current_change_id 主键查且逻辑上属同一 workspace；跨仓 worktree 的双连后缀命名（`<change>--<repoKey>`，worktree.js:245）不匹配 change_key 即 miss 落回（跨仓注册仓的工作树锚定另立变更再议，本变更只覆盖主仓标准布局）；多 daemon 实例各自探测各自宿主，无串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：探测层多一次 RPC（stat 5s）加在每轮 60s 轮询上——离线场景先 stat 失败（静默 miss，≈即时）再 git_status 502，延迟增加可忽略；正常场景 stat 是本地文件 lstat，毫秒级。次风险：current_change_id 有值但 agent 实际已 apply 回主仓继续干、worktree 未清理——探测命中显示工作树分支（非 agent 实际工作目录），语义偏差存在但方向正确（该 change 的隔离环境分支正是用户关心的），接受为显式边界（收口评审裁决）。

试过放弃的方案：① 从会话日志 stdout 文本解析 agent 输出的 worktree 路径——自然语言解析脆弱、覆盖率不可控，放弃；② daemon 侧实时跟踪 agent 进程 cwd——agent 的 cd 是 harness Bash 内 shell 状态，外部进程不可见，机制上不可行，放弃；③ sillyspec worktree create/apply 时回调平台 API 登记——跨系统契约变更（CLI/npm 包 + daemon + backend 三端），且存量已创建的 worktree 无登记回填，重；留作后续正路（平台 worktree 注册表），本变更先零侵入探测。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/daemon/session/service/git_status.py | root 决策链重构：worktree 探测层 + _resolve_root 两段式 + root_source 标注 |
| 修改 | backend/app/modules/daemon/schema.py | SessionGitStatusResponse 加 root_source 字段 |
| 修改 | backend/tests/modules/daemon/test_session_git_status.py | 探测命中/miss/异常落回/无锚跳过用例 |
| 修改 | frontend/src/lib/daemon/sessions.ts | SessionGitStatus 加 root_source |
| 再生成 | backend/openapi.json | pnpm gen:types dump |
| 再生成 | frontend/src/lib/api-types.ts | gen:types 重生成 |
| 再生成 | sillyhub-daemon/src/api-types.ts | gen:types 重生成（断言面闸门配对） |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | badge 工作树标识 + Tooltip 标注 |
| 修改 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | worktree 标识用例 + 既有 mock 补 root_source |
