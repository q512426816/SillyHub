---
author: qinyi
created_at: 2026-07-13 00:08:51
change: 2026-07-12-worker-worktree-isolation
status: draft
---

# 决策台账（Decisions）— per-worker worktree 隔离

> 本变更的决策台账（非长期术语表）。只记录有实现/验收影响的决策。长期术语在 archive/scan 时提升到 `docs/multi-agent-platform/glossary.md`。

---

## D-001@v1 — per-worker worktree 位置

- **type**: architecture
- **status**: accepted
- **source**: brainstorm Step6 用户决策（AskUserQuestion）
- **question**: 每个 worker 的独立 git worktree 副本放在宿主机哪个位置？
- **answer**: workspace root 旁同级（sibling）目录 `<ws.root_path 目录名>-workers/<run.id 短8位>/`。
- **normalized_requirement**: worktree 副本在宿主机文件系统 sibling 于 workspace root，daemon 可直接访问；路径唯一（run.id 短8）；base = default_branch HEAD。
- **impacts**: HostFsDelegate.git_worktree_add 的 sibling_path 计算逻辑；daemon handler 在 `dirname(root)/<root目录名>-workers/<run.id短8>` 跑 `git worktree add`；R-04 命名冲突应对。
- **evidence**: Step6 AskUserQuestion 用户选"工程目录旁同级目录(推荐)"；Step9 设计 §5.1/§7 确认。
- **priority**: P0

---

## D-001@v2 — per-worker worktree 位置（路径修正）

- **type**: architecture
- **status**: accepted
- **supersedes**: D-001@v1
- **source**: execute Wave 1 task-02 实现（assertWithinAllowedRoots 约束发现）
- **question**: D-001@v1 的 sibling 路径（ws.root_path 父目录下 `<root目录名>-workers/`）被 daemon `assertWithinAllowedRoots` 拒绝（daemon allowed_roots 只含 ws.root_path，不含父目录），git_worktree_add forbidden。怎么办？
- **answer**: worktree 放 **workspace 内** `ws.root_path/.worktrees/<run.id短8>/`（allowed_roots 覆盖 ws.root_path 即覆盖 .worktrees/）。
- **normalized_requirement**: sibling_path = ws.root_path + "/.worktrees/" + run.id[:8]；.worktrees/ 加 .gitignore 排除（避免污染源码树/扫描）；其余（branch workers/<run.id>、base_ref default_branch or HEAD、run.id 短8 唯一）不变。
- **impacts**: design §7 路径策略改 workspace 内；task-03 dispatch_worker 算 sibling_path 用新路径；execute 期间 design 修正（allowed_roots 约束推翻 D-001@v1 sibling，功能等价——都是隔离，只是位置从父目录 sibling 改 workspace 内子目录）。
- **evidence**: task-02 host-fs-handler.ts gitWorktreeAdd 实现 assertWithinAllowedRoots(workdir, sibling_path)；记忆 [runtime-allowed-roots-config] allowed_roots 含 workspace root_path；用户 D-001@v1 选 sibling 是位置偏好，allowed_roots 是硬约束，workspace 内 .worktrees 是等价替代。
- **priority**: P0

---

## D-002@v1 — worker 自测边界

- **type**: scope
- **status**: accepted
- **source**: brainstorm Step7 用户决策（AskUserQuestion，Grill P0）
- **question**: git worktree 只 checkout 受管文件，副本缺 node_modules/.venv，worker 怎么跑测试/构建？
- **answer**: worker 在副本里只改代码，不跑测试/构建；所有 worker 合并回 workspace root 后由主 agent（依赖齐全）统一验证。
- **normalized_requirement**: render_worker_prompt 加"只写代码、不跑 test/build"约束；converge 后主 agent 在 workspace root 跑验证作 mission 收尾步骤；副本无需装/共享依赖。
- **impacts**: execution.render_worker_prompt 加约束指令；砍掉"worker 副本装依赖""共享主工作区依赖"两备选；R-01 应对；converge 流程加主 agent 验证步骤。
- **evidence**: Step7 Grill AskUserQuestion 用户选"只写代码，验证留合并后(推荐)"。
- **priority**: P0

---

## D-003@v1 — converge 合并方案

- **type**: architecture
- **status**: accepted
- **source**: brainstorm Step8 用户决策（AskUserQuestion）
- **question**: converge 时怎么把各 worker 代码合并到主工作区？
- **answer**: 方案 A 分支合并——worker 在副本内 `git commit` 到自己的分支，主 agent 在 workspace root 逐个 `git merge` 各 worker 分支。
- **normalized_requirement**: worker prompt 加"完成后必 git add -A && git commit"；finalizer.finalize_execute_mission 调 HostFsDelegate.git_merge 逐个合并；三路 merge 算法。
- **impacts**: render_worker_prompt 加 commit 约束；finalizer 实现 git_merge 调用；supersedes team-main-agent D-005@v2 的"人审 apply-back"实现细节（v2 只定方向，本变更定方案 A）；否决方案 B（patch apply 脆弱）/方案 C（混合违反 YAGNI）。
- **evidence**: Step8 AskUserQuestion 用户选"方案A: 分支合并(推荐)"；git worktree 原生多分支用法 + 三路 merge 鲁棒。
- **priority**: P0

---

## D-004@v1 — 冲突处理

- **type**: architecture
- **status**: accepted
- **source**: brainstorm Step6 用户决策（AskUserQuestion）
- **question**: 多 worker 改同一文件、git merge 冲突怎么处理？
- **answer**: 主 agent（LLM）自动解决——converge_mission MCP tool 把冲突文件标准标记喂给主 agent session，LLM 推理解决后回写。
- **normalized_requirement**: converge_mission MCP tool 支持冲突反向喂主 agent；主 agent 读 `<<<<<<< ======= >>>>>>>` 标记推理；解决回写后 git add 继续 merge；无前端人审 UI。
- **impacts**: 砍前端冲突人审 UI（YAGNI）；mcp_tools converge_mission 扩展冲突解决协议；R-02 缓解（记 agent_run_logs / 失败 --abort 回退 / 解冲突轮次上限 R-07）；连贯 team-main-agent "主 agent 真 LLM 指挥"理念。
- **evidence**: Step6 AskUserQuestion 用户选"主 agent 自动解决"（非推荐的人审兜底，用户偏好全自动）。
- **priority**: P0

---

## D-005@v1 — cleanup 时机

- **type**: architecture
- **status**: accepted
- **source**: brainstorm Step6 用户决策（AskUserQuestion）
- **question**: worker 的独立工作副本何时清理？
- **answer**: converge 合并完成后立即清理——git_merge 全部成功后调 git_worktree_remove 删各 worker 副本。
- **normalized_requirement**: finalizer 合并成功后调 HostFsDelegate.git_worktree_remove；无 GC 机制；patch 已采集为 artifact 供追溯。
- **impacts**: 砍 worktree GC 机制（现有 gc_expired_leases 死代码不复用）；finalizer 流程加 cleanup 步骤；否决"mission 结束清理""保留+超时 GC"两备选。
- **evidence**: Step6 AskUserQuestion 用户选"合并后立即清理(推荐)"。
- **priority**: P1

---

## D-006@v1 — worktree 实现路径

- **type**: architecture
- **status**: accepted
- **source**: team-main-agent task-04b 处置 + 本变更 Step2 代码核实
- **question**: 复用现有 worktree 模块还是走 HostFsDelegate？
- **answer**: 走 HostFsDelegate 轻量路径——backend 新增 3 方法（git_worktree_add/git_merge/git_worktree_remove）+ daemon host-fs-handler 新增 3 实现 + RPC 注册；**不复用** `backend/app/modules/worktree/`（bare-clone lease 模块，daemon-client 下死代码）。
- **normalized_requirement**: delegate.py 加 3 async 方法走 _via_rpc_or_degrade（method=host_fs.git_worktree_add 等）；host-fs-handler.ts 加 3 实现（对齐 git_apply 的 git 子命令执行器）；daemon.ts 注册 3 RPC handler；不动 worktree/ 模块、不动 run_command 白名单（git worktree/merge 走独立 method 非命令白名单）。
- **impacts**: 文件清单（design §6）；YAGNI（不激活死代码）；记忆 worktree-vestigial-under-daemon-client 的"不接线 GC"决策延续。
- **evidence**: task-04b 原文"HostFsDelegate.git_worktree_add + daemon host-fs-handler"；Step2 代码核实 delegate 9 方法 + host-fs-handler.ts 9 方法 + daemon.ts:2205 registerRpcHandler；记忆 worktree-vestigial-under-daemon-client。
- **priority**: P0

---

## D-007@v1 — 前端范围

- **type**: scope
- **status**: accepted
- **source**: YAGNI + D-004 冲突全自动
- **question**: 要不要做 worktree 状态/合并冲突的前端展示？
- **answer**: 不做。worker 状态/进度已有 mission 进度展示（team-main-agent task-07 team-progress 组件），冲突由主 agent 全自动解决无需人审 UI。
- **normalized_requirement**: 无前端改动；worktree 创建/合并/清理对前端透明（仅 backend+daemon 内部）。
- **impacts**: 文件清单不含 frontend；范围聚焦后端+daemon；后续若用户要可视化再走新变更。
- **evidence**: D-004 用户选全自动；YAGNI；team-main-agent task-07 team-progress 已展示 worker 状态。
- **priority**: P2

---

## D-008@v1 — worker 副本 git identity

- **type**: architecture
- **status**: accepted
- **source**: Design Grill Step12（X-002）
- **question**: worker 在 worktree 副本 `git commit`，identity 从哪来？
- **answer**: daemon `git_worktree_add` 时给副本配默认 identity（`git -c user.name=worker -c user.email=worker@sillyhub` 透传，或创建副本后写 `.git/config`），不依赖宿主机 daemon 进程的全局 git config。
- **normalized_requirement**: daemon host-fs-handler.git_worktree_add 实现时，git 命令带 `-c user.name=worker -c user.email=worker@sillyhub`；worker commit 用此 identity；不依赖 daemon 全局 config 是否配置。
- **impacts**: host-fs-handler.ts git_worktree_add 实现细节；R-08 应对；避免 worker commit 因缺 identity 失败（现有 worktree 模块 acquire 的 write_gitconfig:107 是 bare-clone 路径，本变更走轻量 `-c` flag）。
- **evidence**: Design Grill X-002；worktree/service.py:107 write_gitconfig（bare-clone 对照）；execution.dispatch_worker 不传 git identity。
- **priority**: P1
