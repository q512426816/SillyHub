---
author: flow-machine-draft
created_at: 2026-10-21T16:19:51.200Z
---
# 决策记录（Decisions）— 2026-10-21-session-git-branch

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：每 60s 轮询触发 daemon `git_status`（内含 `git fetch`，15s 超时）——remote 慢时轮询堆积。缓解：fetch 失败/超时在 daemon 内降级（fetch_error 字段），分支采集（本地 porcelain）不受阻；轮询仅前台可见时执行；多会话面板并开时按 sessionId 各自 queryKey 独立节流，最坏面=可见面板数×1 次/60s（与会话列表 10s 轮询同量级，可接受）。 试过放弃的方案：① 复用 `git_refs` RPC 推当前分支（head sha 与 refs/heads 匹配）——同 sha 多分支歧义 + detached 不可判，放弃；② daemon 新增轻量 `git_branch` RPC（免 fetch）——跨服务契约变更 + 旧 daemon method_not_found 兼容面，轻量变更不值得，放弃（若后续轮询负载实证过重再立项）；③ `git_gateway`（backend 本机 subprocess）查 worktree——worktree 物理位于 daemon 宿主时 backend 不可达，且 session cwd 语义就是 daemon 宿主路径，方向错，放弃。
