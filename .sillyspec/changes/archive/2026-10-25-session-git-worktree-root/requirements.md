---
author: flow-machine-draft
created_at: "2026-10-25T11:42:55.549Z"
---
# 需求规格（Requirements）— 2026-10-25-session-git-worktree-root

## 功能需求

### FR-01: 会话当前变更存在 sillyspec 工作树时（标准目录布局且未清理），指示项显示该工作树的分支与目录（经 stat 探测命中，root 取工作树路径）

- 端点 root 决策链**必须**前置工作树探测层：`AgentSession.current_change_id` 非空时查 `changes.change_key`（sillyspec change 名），候选路径 = `resolve_root_path_for_daemon(绑定根) + "/.sillyspec/.runtime/worktrees/" + change_key`，经 daemon `host_fs.stat` RPC 探测候选下 `.git`（worktree 检出的 .git 是文件，lstat 语义可见）；探测命中时 root **必须**取工作树路径，分支/脏文件从该工作树采集；响应**必须**新增 `root_source: "worktree" | "cwd" | "workspace_root" | "none"` 字段。

#### 场景：主路径

- Given 会话 current_change_id 指向 change X（change_key=2026-10-25-foo），绑定根下存在 `.sillyspec/.runtime/worktrees/2026-10-25-foo/`（.git 可见），该工作树分支 wt-branch When 请求 git-status Then root=工作树路径、branch=wt-branch、root_source="worktree"

### FR-02: 无工作树/已清理/探测失败的会话行为与现状一致（落回 cwd→绑定根链，空态照旧）

- 探测 miss（目录不存在 / 无 current_change_id / change 行缺失 / stat 返回 exists=false）时**必须**静默落回现有决策链（cwd 优先 → 绑定根），行为与 2026-10-21 版一致；stat RPC 异常（离线/超时/远端错误）**禁止**阻断——静默落回现有链（探测是尽力而为的增强层）；探测**必须**以「绑定根」为锚（daemon-client 模式下每个成员读自己本机的工作区副本）。

#### 场景：回退形态

- Given 会话无 current_change_id 且 cwd 指向主仓 When 请求 git-status Then root=cwd、root_source="cwd"（现状行为零回归）
- Given current_change_id 有值但对应 worktree 目录已清理 When 请求 git-status Then 落回 cwd/绑定根链，不报错
- Given stat RPC 抛 DaemonRuntimeOffline When 请求 git-status Then 落回现有链（后续 git_status RPC 的离线 502 语义照旧，探测异常不新增错误面）

### FR-03: 响应新增 root_source 字段标识根来源，前端在工作树形态给出可见标识

- `SessionGitStatusResponse` / 前端 `SessionGitStatus` 类型**必须**新增 `root_source` 字段；前端指示项在 root_source="worktree" 时**必须**给出可见标识（Tooltip 标注「sillyspec 工作树」+ badge 加工作树标记），其余来源展示与现状一致。

#### 场景：前端标识

- Given 响应 root_source="worktree"、branch=wt-branch When 渲染指示项 Then 显示 ⎇ wt-branch 与工作树标识，Tooltip 含「sillyspec 工作树」字样
- Given 响应 root_source="cwd" When 渲染指示项 Then 展示与现状一致（无工作树标识）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/modules/daemon/test_session_git_status.py「test_git_status_prefers_active_sillyspec_worktree」
FR-02: backend/tests/modules/daemon/test_session_git_status.py「test_git_status_worktree_probe_miss_falls_back_to_cwd」
FR-02: backend/tests/modules/daemon/test_session_git_status.py「test_git_status_worktree_probe_error_falls_back_silently」
FR-02: backend/tests/modules/daemon/test_session_git_status.py「test_git_status_no_change_anchor_skips_probe」
FR-03: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「shows worktree badge when root_source is worktree」
