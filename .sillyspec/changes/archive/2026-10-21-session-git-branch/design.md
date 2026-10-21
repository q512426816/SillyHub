---
author: flow-machine-draft
created_at: "2026-10-21T14:35:37.254Z"
---
# 设计记录（Design Record）— 2026-10-21-session-git-branch

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

现状缺口：工作区会话页顶部 `GitStatusBar` 查的是 **workspace 根目录** 的 git 状态（`GET /api/workspaces/{wid}/git-log/status`，staleTime 60s、无轮询），既不是会话所在 worktree 的分支，也不保证动态。而 `AgentSession.cwd`（SessionManager working dir）在 DB 里有值却不透出，也没有任何端点能按 session 维度查 git。

方案：新增**会话级只读端点** `GET /api/daemon/sessions/{session_id}/git-status`——backend 取该会话（复用 `get_agent_session` 属主校验），解析查询根（`session.cwd` 优先，过 `resolve_root_path_for_daemon` 做 container→host 改写；cwd 空则回退 `session.workspace_id` 的成员绑定根），经既有平名 RPC `git_status`（`ws_hub.send_rpc`，照 `git_log/service.py:_send_git_rpc` 直连模式，30s 超时）在 daemon 宿主上现场执行——每次请求都是实时查询，天然满足「动态、非快照」。daemon `git_status` 内建 fetch 降级（no_remote/fetch_failed/fetch_timeout 不阻断分支采集），分支/脏文件一次拿全，无需新增 daemon 方法、零 daemon 契约变更。

前端：`SessionConfigBar`「智能体档案」控件后新增只读分支指示项（lucide `GitBranch` 图标 + 分支名，Tooltip 展示 root/dirty 概要），组件内 `useQuery(["sessionGitStatus", sessionId])` 自取数（照思考级别控件先例，页面只传 sessionId 已有 prop），`refetchInterval=60_000`（React Query 默认后台标签页不轮询）+ 窗口聚焦 refetch。空态（no_root/no_git）不渲染；查询失败渲染占位「⎇ —」不阻塞其余控件；mobile 与档案控件同收纳。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增 `GET /api/daemon/sessions/{session_id}/git-status`（`backend/app/modules/daemon/router/session_crud.py`），响应 `SessionGitStatusResponse`（新增于 `backend/app/modules/daemon/schema.py`）：
  - `git_mode: "git" | "no_git" | "no_root"`（no_root=会话无 cwd 且无 workspace/绑定可解析；no_git=目录非 git 仓库——daemon error 文案含 "not a git repository"（git 标准文案，`git_gateway/tests` 已依赖同形态）映射 200 空态，其余 error → 502）
  - `root: str | None`（实际查询根，host 视角）、`branch: str | None`、`detached: bool`、`head_short: str | None`、`files_changed/untracked_count: int | None`、`synced_at: str`
- 错误面：会话不存在/跨属主 → 404（`get_agent_session` 内建）；有 workspace 但成员未绑定 daemon → 404（新 `SessionGitNotBound`，文案对齐 git_log 同语义）；daemon 离线/mid-rpc 断连 → 502、RPC 超时 → 504、daemon forbidden（root 越界 allowed_roots，如 worktree 不在白名单）→ 403——错误类定义在 service 内（照 AppError 惯例），不跨模块复用 git_log 错误类（模块自治，文案会话语境）。
- service 实现落 `backend/app/modules/daemon/session/service/git_status.py`（新文件）：root 决策链 cwd → binding；daemon_id 解析复用 `MemberBindingResolver.resolve_member_binding_or_none`（只看本人绑定行，同 git_log `_resolve_binding` 语义）。
- 前端：`frontend/src/lib/daemon/sessions.ts` 新增 `fetchSessionGitStatus(sessionId)` + 类型（`pnpm gen:types` 重生成 `api-types.ts`，脚本守卫要求先提交或 --force 前确认无并行 WIP）；`session-config-bar.tsx` 档案 `ctrlButton` 后新增指示项（非交互、无下拉）。
- 既有面零变更：`/api/workspaces/{wid}/git-log/*`、`useGitLogStatus`、`GitStatusBar`、daemon 侧 `git_status` RPC 十四字段契约、`AgentSessionRead` 均不动（cwd 不透出进 DTO——指示项走独立端点，避免详情轮询被 RPC 拖慢）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。指示项为最终态渲染（每轮轮询整体覆盖上一轮），无增量合并；迟到响应被 React Query 按 queryKey 原子替换，旧值不残留。分支切换瞬间的中间态最多延迟一个轮询周期（≤60s）显示，可接受（FR-02 语义）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   端点纯只读（单 SELECT + 单 RPC），不写任何表；daemon `git_status` 内部 `git fetch` 只更新 remote-tracking refs 且失败即降级不阻断，与 agent 会话正在进行的本地 git 操作冲突面最小（fetch 不动本地分支）。多客户端同会话并开时各自轮询，无共享可变状态。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。会话中途切 worktree/删 worktree → 下轮轮询 RPC 返回 not_found/forbidden → 502/403 → 前端占位降级，不崩；组件卸载时 React Query 自动停轮询（refetchIntervalInBackground 默认 false，后台标签页也暂停）；cwd 被 checkout 切分支不影响端点行为（每次现查）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。root 来源链每个 session 独立解析（cwd → 本 workspace 绑定），`MemberBindingResolver` 按当前用户过滤，跨工作区不会串台；daemon 侧 `assertWithinAllowedRoots`（实体级白名单）兜底——worktree 不在 allowed_roots 时 daemon 拒绝 → 403 → 前端占位（部署配置问题显式暴露而非静默错数据）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：每 60s 轮询触发 daemon `git_status`（内含 `git fetch`，15s 超时）——remote 慢时轮询堆积。缓解：fetch 失败/超时在 daemon 内降级（fetch_error 字段），分支采集（本地 porcelain）不受阻；轮询仅前台可见时执行；多会话面板并开时按 sessionId 各自 queryKey 独立节流，最坏面=可见面板数×1 次/60s（与会话列表 10s 轮询同量级，可接受）。

试过放弃的方案：① 复用 `git_refs` RPC 推当前分支（head sha 与 refs/heads 匹配）——同 sha 多分支歧义 + detached 不可判，放弃；② daemon 新增轻量 `git_branch` RPC（免 fetch）——跨服务契约变更 + 旧 daemon method_not_found 兼容面，轻量变更不值得，放弃（若后续轮询负载实证过重再立项）；③ `git_gateway`（backend 本机 subprocess）查 worktree——worktree 物理位于 daemon 宿主时 backend 不可达，且 session cwd 语义就是 daemon 宿主路径，方向错，放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 新增 | backend/app/modules/daemon/session/service/git_status.py | 会话级 git 状态 service：root 决策链 + git_status RPC + 错误映射 |
| 新增 | backend/tests/modules/daemon/test_session_git_status.py | 端点测试：cwd 主路径/每请求现查/no_root/no_git/404/403/502 |
| 修改 | backend/app/modules/daemon/schema.py | 新增 SessionGitStatusResponse |
| 修改 | backend/app/modules/daemon/router/session_crud.py | 新增 GET /sessions/{session_id}/git-status 端点 |
| 修改 | backend/app/modules/daemon/router/__init__.py | _ENDPOINT_ORDER 登记新端点（拆分不变量表同步） |
| 再生成 | backend/openapi.json | 新端点入 openapi 契约（pnpm gen:types dump） |
| 修改 | frontend/src/lib/daemon/sessions.ts | 新增 fetchSessionGitStatus + queryKey |
| 再生成 | frontend/src/lib/api-types.ts | pnpm gen:types 重生成（新端点类型） |
| 再生成 | sillyhub-daemon/src/api-types.ts | pnpm -C sillyhub-daemon gen:types 重生成（openapi 契约钉子配对，pre-commit 断言面闸门要求同提交） |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | 档案控件后新增 git 分支指示项（含 mobile 收纳与空态隐藏） |
| 修改 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | 指示器用例：渲染/轮询/空态隐藏 |
