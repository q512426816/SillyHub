---
author: qinyi
created_at: 2026-07-13 00:08:51
change: 2026-07-12-worker-worktree-isolation
status: draft
scale: large
source_change: 2026-07-12-team-main-agent-orchestration (task-04b 拆出)
---

# 设计文档（Design）— per-worker worktree 隔离

## 1. 背景

team-main-agent v2（`2026-07-12-team-main-agent-orchestration`，已归档）落地了主 agent 真编排：主 agent 是真 agent（走 daemon interactive lease + MCP tool），像项目经理动态指挥用户预设的 worker 列表（dispatch_worker / get_worker_result / converge_mission / list_workers / report_progress），三重收敛（worker 全完 / 主 agent 判断达成 / 预算硬截断）。

其中 task-02 已为 `AgentRun` 加 `worktree_branch` 字段（model.py:293），task-04 已做 patch 采集（worker 的 `diff_summary` → `kind=patch` AgentArtifact）+ converge 路由（有 patch → `finalize_execute_mission`，无 patch → `finalize_bootstrap_mission`）。

但 **per-worker worktree 隔离 + converge 实际 git merge** 被拆为 task-04b（本变更）——因为含 daemon 侧改动（HostFsDelegate 新方法 + daemon host-fs-handler）、范围较大，用户决策单独走完整 SillySpec 流程。

**当前问题**：`execution.dispatch_worker`（execution.py:88）走 `placement.dispatch_to_daemon(..., root_path=ws.root_path)`，所有 worker 共用 workspace root 作为 cwd → **并发写同一份代码会互相覆盖**。`finalize_execute_mission`（finalizer.py:167）当前只是"采集 patch 列表供人审 apply-back"，注释明确"实际 git merge 留 task-04b per-worker worktree"——即合并逻辑完全缺失。

## 2. 设计目标

- **per-worker 独立 worktree**：每个 worker 在 workspace root 旁的 sibling 目录获得独立 git worktree，写隔离，并发不覆盖
- **worker 在副本内 commit**：worker 改完代码 `git commit` 到自己的分支（为分支合并）
- **converge 分支合并**：主 agent 收敛时，backend 在 workspace root 逐个 `git merge` 各 worker 分支
- **冲突主 agent LLM 自动解决**：merge 冲突时，主 agent 读标准冲突标记推理解决、回写（非人审 UI）
- **合并后立即清理**：converge 成功后删除各 worker 副本（patch 已采集）
- **跨 backend + daemon**：所有 git 操作经 HostFsDelegate → daemon WS RPC 在宿主机执行

## 3. 非目标

- **不复用** `backend/app/modules/worktree/`（bare-clone lease 模块）——daemon-client 架构下被旁路成死代码（记忆 worktree-vestigial-under-daemon-client），走 HostFsDelegate 轻量路径
- **不做前端冲突人审 UI**——冲突由主 agent LLM 全自动解决（用户决策 D-004）
- **不做 worktree GC 机制**——合并后立即清理，无需过期 GC
- **worker 不在副本跑测试/构建**——验证留 converge 后主工作区统一跑（用户决策 D-002，副本缺 node_modules/.venv）
- **不做 worker 自动拆解**——继承 team-main-agent D-002@v2 用户预设
- **不做 worker DAG 依赖**——v1 flat 沿用

## 4. 拆分判断

中等复杂度，**无需拆分**。功能链路紧耦合（worktree 创建 → worker 写代码 commit → converge merge → 冲突解决 → cleanup 是一条完整生命周期链，不可独立交付）；无多角色视图；无跨页面状态流转；任务数 < 10；非模板×数据模式。本质是 team-main-agent v2 拆出的单个 task 完整实现。

## 5. 总体方案

### 5.1 worker worktree 生命周期

```
主 agent 派 worker (dispatch_worker MCP tool)
   │
   ▼
backend execution.dispatch_worker:
   1. 算 sibling_path = <ws.root_path 父>/<root目录名>-workers/<run.id 短8>
      branch = workers/<run.id 短8>
      base_ref = ws.default_branch (HEAD)
   2. HostFsDelegate.git_worktree_add → daemon 跑 `git worktree add <sibling> -b <branch> <base_ref>`
   3. 填 AgentRun.worktree_branch = branch
   4. 把 sibling_path 作 root_path 传 placement.dispatch_to_daemon
   │
   ▼
daemon worker 进程: cwd = sibling 副本
   - render_worker_prompt 约束: 只写代码、不跑 test/build、完成后必 git add -A && git commit
   │
   ▼
worker 完成 → daemon complete_lease:
   - 从副本 cwd 跑 git diff（commit diff）→ diff_summary 回灌（task-04 既有链路，自动指向副本）
   │
   ▼
主 agent converge (converge_mission MCP tool):
   backend finalizer.finalize_execute_mission:
   5. 取各 worker worktree_branch
   6. HostFsDelegate.git_merge 逐个合并到 workspace root
      - ok=True → 继续下一个
      - ok=False + conflicts → 喂主 agent LLM 解决（见 5.2）
   7. 全合并成功 → 采 workspace root 合并 diff 作 kind=patch artifact
   8. HostFsDelegate.git_worktree_remove 各 worker 副本（仅成功路径清理；merge 失败回退时副本保留供人工排查，见 §9）
```

### 5.2 冲突解决（主 agent LLM 自动，converge_mission 可重入）

主 agent 是真 agent（daemon interactive lease，**cwd = workspace root**，有完整 SDK Read/Write/Bash 工具）。`converge_mission` MCP tool（mcp_tools.py:293）设计为**可重入**，无需新 host_fs 写文件 RPC（host_fs 现有 9 方法只读为主，主 agent 直接用 SDK 工具写更简、更连贯"主 agent 真指挥"）：

1. 主 agent 调 `converge_mission` → backend `finalize_execute_mission` 调 `HostFsDelegate.git_merge` 合并下一个 worker 分支
2. 合并成功 → tool 返回 `{status: merged, branch}` → 主 agent 再调继续下一个（全部完成返回 done）
3. 合并冲突 → tool 返回 `{status: conflict, conflicts: [{file, marker_lines}]}` 给主 agent
4. **主 agent 自己**用 SDK `Read` 读冲突文件（cwd=workspace root，冲突标记已在工作区）、LLM 推理解决、`Write` 回写、`Bash git add` → 不经 host_fs RPC
5. 主 agent 再调 `converge_mission`（重入）→ backend 检测 merge in progress → `git merge --continue`（或合下一个 worker_branch）

**缓解措施**（R-02）：
- 解决过程记 `agent_run_logs`（主 agent Read/Write 天然经 SDK 日志，可追溯哪个冲突怎么解）
- 整体失败（含超 R-07 解冲突轮次上限）→ `git merge --abort` 回退（workspace root 保持 merge 前）+ 标 mission 需人工介入 + worker 副本保留（§9）
- worker 按文件分工（主 agent 派发时在 objective 里指示分工）从源头减冲突（R-03 沿用）

### 5.3 Wave 划分（plan 阶段细化）

- **Wave 1（基础设施）**：HostFsDelegate 新增 3 方法 + daemon host-fs-handler 新增 3 方法 + RPC 注册 + 单测
- **Wave 2（worker 接线）**：execution.dispatch_worker 接 worktree + render_worker_prompt 约束 + worktree_branch 填值 + 单测
- **Wave 3（converge）**：finalizer.finalize_execute_mission 实现 git merge + LLM 解冲突 + 合并后清理 + 单测

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增方法 | `backend/app/modules/daemon/host_fs/delegate.py` | `git_worktree_add` / `git_merge` / `git_worktree_remove`（仿 `git_apply` 走 `_via_rpc_or_degrade`，method=`host_fs.git_worktree_add` 等） |
| 修改 | `backend/app/modules/agent/execution.py` | `dispatch_worker`（:88）接 worktree：算 sibling 路径 + 调 git_worktree_add + 把副本路径作 root_path 传 dispatch_to_daemon + 填 worktree_branch；`render_worker_prompt`（:65）加"只写代码、必 commit"约束 |
| 修改 | `backend/app/modules/agent/finalizer.py` | `finalize_execute_mission`（:167）从"采 patch 列表"升级为实际 git merge + LLM 解冲突 + 合并后清理 |
| 修改 | `backend/app/modules/agent/mcp_tools.py` | `converge_mission`（:293，确认）改可重入：逐个 worker merge，冲突返回标记给主 agent，主 agent 自己 SDK 解决后重入继续（见 §5.2） |
| 修改 | `sillyhub-daemon/src/host-fs-handler.ts` | 新增 `git_worktree_add` / `git_merge` / `git_worktree_remove` 实现（对齐现有 git_apply 的 git 子命令执行器 :306） |
| 修改 | `sillyhub-daemon/src/daemon.ts` | 注册 3 个 RPC handler（:2205 附近，仿 `host_fs.git_apply` 注册） |
| 新增测试 | `backend/app/modules/daemon/host_fs/tests/` | delegate 3 方法单测（mock WS RPC） |
| 新增测试 | `backend/app/modules/agent/tests/` | dispatch_worker 接 worktree + finalize_execute_mission merge 单测 |
| 新增测试 | `sillyhub-daemon/tests/` | host-fs-handler 3 方法单测（mock git 子进程） |
| 不改 | `backend/app/modules/worktree/` | bare-clone lease 模块，死代码不复用 |
| 不改 | `frontend/` | YAGNI，无前端改动 |

## 7. 接口定义

### backend HostFsDelegate 新方法

```python
async def git_worktree_add(
    self,
    workspace: Workspace,
    *,
    sibling_path: str,
    branch: str,
    base_ref: str,
) -> dict:
    """Add a git worktree at sibling_path on branch (based off base_ref).
    daemon 侧跑 `git -C <root> worktree add <sibling_path> -b <branch> <base_ref>`.
    Returns {ok, worktree_path, error}。失败(degraded)返回 {ok:False, error}。"""

async def git_merge(
    self,
    workspace: Workspace,
    *,
    worker_branch: str,
) -> dict:
    """Merge worker_branch into workspace root 当前 HEAD.
    daemon 侧跑 `git -C <root> merge --no-ff <worker_branch>`。
    Returns {ok, conflicts: [{file, marker_lines}], merged_files, error}。
    ok=False + conflicts 非空 → 有冲突标记，caller 喂主 agent LLM 解决。"""

async def git_worktree_remove(
    self,
    workspace: Workspace,
    *,
    sibling_path: str,
) -> dict:
    """Remove the worktree at sibling_path.
    daemon 侧跑 `git -C <root> worktree remove --force <sibling_path>`。
    Returns {ok, error}。"""
```

### daemon host-fs-handler 新 RPC 方法

| RPC method | 入参 | 返回 |
|---|---|---|
| `host_fs.git_worktree_add` | `{ workdir, sibling_path, branch, base_ref }` | `{ ok, worktree_path, error }` |
| `host_fs.git_merge` | `{ workdir, worker_branch }` | `{ ok, conflicts, merged_files, error }` |
| `host_fs.git_worktree_remove` | `{ workdir, sibling_path }` | `{ ok, error }` |

### 路径/分支策略

```
worktree_root = ws.root_path + "/.worktrees"        # workspace 内（D-001@v2：daemon allowed_roots 只含 ws.root_path，父目录 sibling 会被 assertWithinAllowedRoots 拒绝）
sibling_path  = worktree_root + "/" + run.id[:8]    # run.id 短8 保证唯一；.worktrees/ 加 .gitignore 排除污染
branch        = "workers/" + run.id[:8]
base_ref      = ws.default_branch or "HEAD"        # 空值兜底 HEAD（execution.py:106 同款可空语义；工作区未提交改动不带入副本）
```

## 7.5 生命周期契约表

（涉及 lease / agent_run / daemon / complete / lifecycle，必填）

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| dispatch_worker（创建 worktree） | backend execution | daemon `host_fs.git_worktree_add` | workspace_id, sibling_path, branch, base_ref | worker run pending → running |
| worker 在副本写+commit | daemon（worker SDK 进程） | 副本 git repo（cwd=sibling_path） | worktree_path(作 cwd), branch, prompt 约束 | worktree active |
| worker complete_lease | daemon | backend lease 回灌 | lease_id, agent_run_id, diff_summary(commit diff) | worker run running → completed |
| converge git_merge | backend finalizer | daemon `host_fs.git_merge` | workspace_id, worker_branch | mission converge 进行中 |
| merge 冲突→converge 返回 | backend converge_mission tool | 主 agent（tool 返回值） | `{status:conflict, conflicts:[{file,marker_lines}]}` | 主 agent 进入冲突解决 |
| 冲突解决回写 | 主 agent（SDK Write/Bash，cwd=workspace root） | workspace root 文件 + git add | 解决后文件内容（主 agent 自己写，无需新 host_fs RPC） | merge 待 continue |
| converge 重入继续 | 主 agent 再调 converge_mission | backend → `git merge --continue` / 下一个 worker_branch | 上次解决结果已 git add | merge 继续/完成 |
| 合并后清理 | backend finalizer | daemon `host_fs.git_worktree_remove` | workspace_id, sibling_path | worktree removed |

> 所有事件均有对应代码任务（Wave 1/2/3）+ 接口任务（§7）+ 测试任务（§6）。必需字段均出现在 §7 接口定义。

## 8. 数据模型

- **`AgentRun.worktree_branch`**（task-02 已加，`20260712_team_orch` migration）：本变更在 dispatch_worker 时填值 `workers/<run.id 短8>`，converge 时读取。**无新列**。
- **`AgentArtifact kind=patch`**（task-04 已加）：converge 后采 workspace root 合并 diff。**无新列**。
- worktree 是临时文件系统对象，**不入库**（生命周期由 dispatch/converge 管理，合并后即删）。
- **无新表/无新 migration**。

## 9. 兼容策略（brownfield）

- **single mode mission**（非 team）：不触发 dispatch_worker（team 专属），零回归。
- **bootstrap mission**（read-only summary）：走 `finalize_bootstrap_mission`，不触发 git merge，零回归。
- **execute mission 无 patch**（worker 未写代码）：`finalize_execute_mission` 返回空 → 回退 `finalize_bootstrap_mission`（task-04 既有路由，converge_mission_for_completed_run:230）。
- **worktree 创建失败**（daemon 离线/RPC 失败/git 错）：worker run 标 `failed`，主 agent 决策补派（worker_preset 内重 dispatch 或收敛），不崩 mission。
- **merge 整体失败**（含解冲突超 R-07 轮次）：`git merge --abort` 回退，workspace root 保持 merge 前，标 mission 需人工介入；**worker 副本保留**（不清理，供人工排查 worker 原始产出，区别于成功路径的立即清理）。
- **未配置 team 的既有 workspace**：行为完全不变（dispatch_worker 仅 team mission 调用）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | worktree 副本缺 node_modules/.venv，worker 跑测试失败 | P1 | worker prompt 约束只写代码不跑 test（D-002 用户决策）；验证留 converge 后主工作区统一跑 |
| R-02 | git merge 冲突，LLM 解错丢代码 | P1 | 解决过程记 agent_run_logs 可追溯；merge 失败 `--abort` 回退 + 标人工兜底；worker 按文件分工源头减冲突 |
| R-03 | workspace root 不干净（未提交改动），merge 交互复杂 | P1 | team mission 场景默认 workspace root 为工作区；worker base_ref=default_branch HEAD，工作区未提交改动不带入副本 |
| R-04 | sibling 目录命名冲突/残留 | P2 | run.id 短8 保证唯一；git_worktree_add 前检查残留并清；合并后立即删 |
| R-05 | daemon 离线时 worktree 创建失败 | P1 | worker run 标 failed，主 agent 决策补派（NoOnlineDaemonException 既有路径） |
| R-06 | git worktree add 跨平台路径（Windows 反斜杠/权限） | P2 | sibling_path 走 daemon 侧宿主机原生路径（resolve_root_path_for_daemon 模式）；测试覆盖 Win/Linux |
| R-07 | 主 agent LLM 解冲突死循环（反复解不出） | P2 | 限制解冲突轮次（如 3 轮），超限判 mission 失败 + 标人工介入 |
| R-08 | worker 在副本 `git commit` 缺 identity（daemon 进程全局 git config 未配 user.name/email） | P1 | daemon `git_worktree_add` 时给副本配默认 identity（`git -c user.name=worker -c user.email=worker@sillyhub` 透传或写副本 .git/config），不依赖宿主机全局 config（D-008） |

## 11. 决策追踪

本变更决策台账见 `decisions.md`，当前版本 D-001@v1 ~ D-007@v1：

| 决策 ID | 内容 | 覆盖章节 | 来源 |
|---|---|---|---|
| D-001@v1 | per-worker sibling worktree（`<root目录名>-workers/<run.id短8>/`，base=default_branch HEAD） | §5.1 / §7 | Step6 用户 |
| D-002@v1 | worker 只写代码不跑测试，验证留 converge 后 | §3 / §5 / R-01 | Step7 用户 |
| D-003@v1 | converge 走分支合并（方案A：worker commit + git merge） | §5 / §7 | Step8 用户（supersedes team-main-agent D-005@v2 的"人审 apply-back"细节） |
| D-004@v1 | 冲突主 agent LLM 自动解决（非人审 UI） | §5.2 / §7.5 / R-02 | Step6 用户 |
| D-005@v1 | 合并后立即清理 worktree（无 GC） | §5.1 / §3 | Step6 用户 |
| D-006@v1 | 走 HostFsDelegate 轻量路径，不复用 bare-clone worktree 模块 | §3 / §6 | task-04b 处置 + Step2 代码核实 |
| D-007@v1 | 无前端改动（YAGNI） | §3 / §6 | YAGNI + D-004 |
| D-008@v1 | worker 副本配默认 git identity（不依赖宿主机全局 config） | §7 / R-08 | Design Grill X-002 |

**继承 team-main-agent v2 决策**：D-002@v2（用户预设 worker）/ D-005@v2（per-worker worktree 方向）/ D-006@v2（三重收敛）/ D-007@v2（MCP tool 反向调用）。本变更补 D-005@v2 的实现细节（路径/合并/冲突/cleanup），不推翻 v2 方向。

**仍未解决/遗留**：AC-9 真部署 e2e（team-main-agent 遗留）+ 本变更的 daemon complete_lease e2e（merge 后 diff 回灌真链路）留 verify/部署阶段。

## 12. 自审

| 检查项 | 结果 | 说明 |
|---|---|---|
| 需求覆盖 | ✅ | Step6 三决策（位置/冲突/cleanup）+ Step7（worker 自测）全覆盖 |
| Grill 覆盖 | ✅ | decisions.md 所有 D-xxx@v1 在 §11 引用 |
| 约束一致性 | ✅ | backend ruff/mypy + daemon tsc + REST /api 前缀 + HostFsDelegate `_via_rpc_or_degrade` RPC 模式（与现有 git_apply 一致） |
| 真实性 | ✅ | 类名/方法名/行号来自真实代码：HostFsDelegate.git_apply:267 + `_via_rpc_or_degrade`:616 / host-fs-handler.ts:454 git_apply / daemon.ts:2205 registerRpcHandler / finalize_execute_mission:167 / dispatch_worker:88 / render_worker_prompt:65 / AgentRun.worktree_branch:293 |
| YAGNI | ✅ | 砍前端冲突 UI / 砍 GC / 砍依赖装/共享 / 砍 worktree 模块复用 |
| 验收标准 | ✅ | 见 tasks（per-worker 隔离单测 + git merge 冲突单测 + cleanup 单测 + daemon handler 单测 + 三重收敛集成） |
| 非目标清晰 | ✅ | §3 明确 6 项不做 |
| 兼容策略 | ✅ | §9 五路径（single/bootstrap/无 patch/创建失败/merge 失败） |
| 风险识别 | ✅ | §10 七条（R-01~R-07） |
| 生命周期契约表 | ✅ | §7.5 七事件覆盖 dispatch/write/complete/merge/conflict/回写/cleanup，必需字段在 §7 DTO |

**自审结论**：通过。所有章节完整、决策有据、约束一致、真实可追溯。

### 12.1 Design Grill 修正（Step12 交叉审查）

交叉审查发现 4 个结构性问题，全部可从代码确定、已修正（无需用户判断）：

| ID | 层级 | 问题 | 修正 |
|---|---|---|---|
| X-001 | feasibility | §7 `base_ref=ws.default_branch` 未处理空值（execution.py:106 同款可空） | §7 改 `ws.default_branch or "HEAD"` 兜底 |
| X-002 | feasibility | worker 副本 git commit 缺 identity（dispatch_worker 不传、host_fs 无配 identity） | 新增 D-008 + R-08：daemon git_worktree_add 时配默认 identity，不依赖宿主机全局 config |
| X-003 | consistency | §5.1 步骤8 清理 vs §9 merge 失败回退，副本生命周期未定义 | §5.1/§9 明确：成功才清理，失败保留副本供排查 |
| X-004 | consistency | §5.2"MCP tool 回写"与 host_fs 只读为主冲突 | §5.2/§7.5 改：主 agent 自己 SDK Read/Write 解决（cwd=workspace root），converge_mission 可重入，无需新 host_fs RPC |

**Design Grill Result: passed**。无 P0/P1 unresolved blocker，可进入 plan。
