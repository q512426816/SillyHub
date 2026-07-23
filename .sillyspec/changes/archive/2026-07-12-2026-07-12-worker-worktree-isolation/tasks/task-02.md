---
id: task-02
title: daemon host-fs-handler.ts 新增 3 方法（git_worktree_add/git_merge/git_worktree_remove）+ daemon.ts 注册 3 RPC handler + 单测
title_zh: daemon host-fs-handler 实现 worktree 三方法 + 注册 + 单测
author: qinyi
created_at: 2026-07-13 00:32:41
priority: P0
depends_on: []
blocks: [task-03, task-05, task-07]
requirement_ids: [FR-01, FR-03, FR-05, FR-06]
decision_ids: [D-006@v1, D-008@v1]
allowed_paths:
  - sillyhub-daemon/src/host-fs-handler.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/host-fs-handler-worktree.test.ts
provides:
  - contract: HostFsWorktreeRpcHandlers
    fields: [git_worktree_add, git_merge, git_worktree_remove]
goal: >
  daemon 侧实现 3 个 host_fs RPC handler（git worktree add/merge/remove）+ daemon.ts 注册 + 单测，git_worktree_add 带默认 git identity（-c user.name/email）不依赖宿主机全局 config。
implementation:
  - 读 host-fs-handler.ts git_apply(:454 gitApply 方法 / :313 runGitApply 子命令执行器) + daemon.ts:2205 registerRpcHandler 模式
  - git_worktree_add({workdir, sibling_path, branch, base_ref}): 跑 `git -C <workdir> -c user.name=worker -c user.email=worker@sillyhub worktree add <sibling_path> -b <branch> <base_ref>` → {ok, worktree_path, error}
  - git_merge({workdir, worker_branch}): 跑 `git -C <workdir> merge --no-ff <worker_branch>`，按 exit code + 冲突文件 marker 解析 → {ok, conflicts:[{file, marker_lines}], merged_files, error}
  - git_worktree_remove({workdir, sibling_path}): 跑 `git -C <workdir> worktree remove --force <sibling_path>` → {ok, error}
  - daemon.ts:2205 附近 _registerHostFsRpcHandler 内注册 host_fs.git_worktree_add/git_merge/git_worktree_remove（仿 host_fs.git_apply :2205）
  - 单测 host-fs-handler-worktree.test.ts mock git 子进程（runCmd）
acceptance:
  - 3 handler 注册并可被 backend delegate RPC 调用
  - git_worktree_add 命令含 -c user.name=worker -c user.email=worker@sillyhub（D-008，不依赖宿主机全局 git config）
  - git_merge 正确解析冲突标记（marker_lines 非空，按 stderr/exit code 判定）
  - vitest 绿
verify:
  - cd sillyhub-daemon && pnpm test -- host-fs-handler-worktree
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - assertWithinAllowedRoots 守 cwd 越界（沿用现有安全守卫，gitApply:479 同款）
  - git 命令带 -c user.name/email，不依赖宿主机全局 git config（D-008，R-08）
  - 不碰 run_command 白名单逻辑（worktree/merge 走独立 handler，非 gate 命令路径）
---
