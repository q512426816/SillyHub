---
proposed_at: 2026-11-06T14:08:57.121Z
category: known-issues
source: 2026-11-06 用户报障排查（代码溯源，非变更产物）
status: pending_review
---

# 非工作区会话结束后无法重新开启（409 NO_CWD）

现象：不挂工作区创建的会话（平台直接聊天），结束或超时回收后点「重新开启」必报 HTTP_409_DAEMON_SESSION_NO_CWD「该会话无关联工作目录，无法恢复对话记录」，历史可看但会话永久不可续。

根因：非工作区会话创建时不写 cwd 字段（backend inject_gates.py 仅在传 workspace_id 时才落 cwd=workspace.root_path）；reopen 的 SDK resume 依赖 cwd 去 Claude transcript 存档目录定位记录（transcript 按 encoded-cwd 编码目录归档），cwd 为空则必然失败，2026-08-21-session-reopen-resume 设计决策 DS-7 提前以 409 拒绝（session_lifecycle.py reopen 前置校验）。当时语境认定无 cwd 会话等于 scan/bootstrap 一次性会话，普通闲聊场景撞上该墙。

会话「自动结束」属正常生命周期：空闲回收、daemon 重启 suspend、reconnecting 超 180 秒巡检收敛（RECONNECTING_RETRY_WINDOW_SEC）。

规避：需长期续聊的会话建在工作区下。根治方向（未立项）：一是创建时给非工作区会话分配平台托管默认目录作 cwd；二是 reopen 时从 daemon 运行记录自愈回填（参考 _heal_agent_session_id_from_runs 先例）。

---
> This is a proposed knowledge entry. Review and merge into manual/ or generated/.