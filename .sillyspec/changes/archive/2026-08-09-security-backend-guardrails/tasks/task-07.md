---
id: task-07
title: 测试 SSRF 三连（test_ssrf.py / test_webhook_ssrf.py / test_repo_url_guard.py：IPv6/重定向/注册内网/协议白名单含 C:\foo）
title_zh: 测试 SSRF 三连
author: qinyi
created_at: 2026-08-09 21:54:41
priority: P0
depends_on: [task-01, task-03, task-04, task-05]
blocks: []
requirement_ids: [FR-07, FR-08, FR-09, FR-10]
decision_ids: [D-003@v1, D-004@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/tool_gateway/tests/test_ssrf.py
  - backend/app/modules/mcp_gateway/tests/test_webhook_ssrf.py
  - backend/app/modules/worktree/tests/test_repo_url_guard.py
goal: >
  新建三测试文件覆盖 SSRF 三连：http_get IPv6+重定向、mcp webhook 注册/投递、worktree repo_url 协议白名单。
implementation:
  - tool_gateway/tests/test_ssrf.py(http_get [::1]/fe80::/fc00:: 拒、重定向到 127.0.0.1/169.254.169.254 拒 mock httpx 逐跳、缺 Location 返 Invalid redirect、≤3跳公网正常)
  - mcp_gateway/tests/test_webhook_ssrf.py(create 注册内网/本机/云元数据/file:// 抛 400、公网 mock 放行、_deliver_one 复查私网记 warn 放弃)
  - worktree/tests/test_repo_url_guard.py(assert_safe_repo_url 纯函数：放行 https/ssh/git/git@host:path/host.xz:path、拒 ext::/file:///abs//abs/./rel/../C:\foo/C:/foo/空/单字母 X:foo、clone_bare ext:: 抛 UnsafeRepoUrl 不调 git)
acceptance:
  - AC-6/7/8/9
  - 三测试文件全绿
  - ruff format
verify:
  - cd backend && pytest app/modules/tool_gateway/tests/test_ssrf.py app/modules/mcp_gateway/tests/test_webhook_ssrf.py app/modules/worktree/tests/test_repo_url_guard.py -q && ruff check app/modules/tool_gateway/tests/test_ssrf.py app/modules/mcp_gateway/tests/test_webhook_ssrf.py app/modules/worktree/tests/test_repo_url_guard.py
constraints:
  - DNS mock 纪律防 flaky：公网放行路径 mock assert_public_hostname/assert_public_url 返回 None（不依赖真实 DNS）
  - 拒绝路径 mock 抛 SsrfBlocked/UnsafeRepoUrl 或纯字符串断言（assert_safe_repo_url 纯函数不经 DNS 直接测）
  - 修 test_webhook.py 的 hooks.example.com fixture（见 task-03）
---
三测试文件与三出站点一一对应。assert_safe_repo_url 纯函数测试不经网络，是协议白名单最稳的回归门。
