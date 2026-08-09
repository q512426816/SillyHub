---
id: task-01
title: 新建 SSRF 统一入口 app/core/ssrf.py（assert_public_url 全量 + assert_safe_repo_url 协议白名单 + UnsafeRepoUrl 400）
title_zh: 新建 SSRF 统一入口 core/ssrf.py
author: qinyi
created_at: 2026-08-09 21:54:41
priority: P0
depends_on: []
blocks: [task-03, task-04, task-05, task-07]
requirement_ids: [FR-07, FR-08, FR-10]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - backend/app/core/ssrf.py
provides:
  - contract: assert_public_url
    fields: [url, allowed_schemes]
  - contract: assert_safe_repo_url
    fields: [repo_url]
  - contract: UnsafeRepoUrl
    fields: [code, http_status]
goal: >
  新建 app/core/ssrf.py 作 SSRF 统一入口，façade 复用 tool_policy.assert_public_hostname，提供 URL 级全量校验与 git repo 协议白名单，供三出站点共用。
implementation:
  - 定义 UnsafeRepoUrl(AppError,code=HTTP_400_UNSAFE_REPO_URL,http_status=400)
  - async assert_public_url(url,*,allowed_schemes=('http','https'))：urlparse 校 scheme 非法抛 UnsafeRepoUrl→取 hostname→await ToolPolicyService.assert_public_hostname(host) 私网/不可解析抛 SsrfBlocked
  - def assert_safe_repo_url(repo_url)：空抛/ext::前缀抛/含'://'则 urlparse.scheme∈{https,ssh,git}放行否则抛/scp-like(无'://'且含':')取首':'前 token 须匹配^[A-Za-z0-9.@-]+$ 且长度≥2 放行否则抛/其余裸路径抛
  - import from app.modules.tool_gateway.tool_policy import SsrfBlocked, ToolPolicyService
acceptance:
  - python -c "import app.core.ssrf" 无循环导入
  - assert_public_url('https://x')调用链通
  - assert_safe_repo_url 对 https/ssh/git/git@host:path 放行、ext::/file:///abs/C:\foo 拒
verify:
  - cd backend && python -c "import app.core.ssrf" && ruff check app/core/ssrf.py
constraints:
  - 不改 tool_policy.py（零回归）
  - 不查 IP 的 assert_safe_repo_url 允许内网 git（D-004）
  - 跨平台纯 Python
---
本卡为 SSRF 三连的共享地基，必须最先完成且零回归。UnsafeRepoUrl 统一用 400 而非各出站点自带错误码。
