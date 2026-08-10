---
id: task-04
title: worktree clone 协议白名单（clone_bare 前 assert_safe_repo_url，含 Windows 盘符收紧）
title_zh: worktree clone 协议白名单
author: qinyi
created_at: 2026-08-09 21:54:41
priority: P0
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-07]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/worktree/git_runner.py
expects_from:
  task-01:
    - contract: assert_safe_repo_url
      needs: [repo_url]
goal: >
  worktree clone repo_url 加协议白名单，堵 ext::(RCE)/file://(读本地)/裸路径，放行 https/ssh/git/scp-like 含内网 git。
implementation:
  - import from app.core.ssrf import assert_safe_repo_url
  - clone_bare() 在 _run([clone,--bare,repo_url,...]) 前 assert_safe_repo_url(repo_url)，非法抛 UnsafeRepoUrl(400)
acceptance:
  - ext::/file:///abs//abs/C:\foo/C:/foo/空 拒
  - https://x/ssh://x/git://x/git@host:path/host.xz:path 放行
  - spike-02 grep 现存 repo_url 数据/种子确认无 file:///裸路径（R-05）
verify:
  - cd backend && pytest app/modules/worktree -q && ruff check app/modules/worktree/git_runner.py
constraints:
  - 不查 IP（D-004 允许内网 git）
  - UnsafeRepoUrl 400 而非复用 WorktreeAcquireFailed(503)
---
最薄的一卡，单点单行接入 assert_safe_repo_url。Windows 盘符 C:\foo 与 C:/foo 均须拒。
