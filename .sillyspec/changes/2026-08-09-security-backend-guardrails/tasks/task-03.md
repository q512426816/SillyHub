---
id: task-03
title: mcp webhook SSRF 双查（create 注册前 + _deliver_one 投递前 assert_public_url，best-effort catch）
title_zh: mcp webhook SSRF 双查
author: qinyi
created_at: 2026-08-09 21:54:41
priority: P0
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-08, FR-09]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/mcp_gateway/service.py
  - backend/app/modules/mcp_gateway/tests/test_webhook.py
expects_from:
  task-01:
    - contract: assert_public_url
      needs: [url, allowed_schemes]
goal: >
  mcp webhook 注册与投递前都过 SSRF 校验，堵注册指向内网/本机/云元数据的回调，投递前复查防 DNS 重绑定。
implementation:
  - import from app.core.ssrf import assert_public_url + from app.modules.tool_gateway.tool_policy import SsrfBlocked（UnsafeRepoUrl 经 assert_public_url 抛、catch 时一并捕）
  - create() 构造 ORM 行前 await assert_public_url(url.strip()) 异常传播全局 400
  - _deliver_one() client.post 前 await assert_public_url(webhook.url) 包进现有 try、catch(SsrfBlocked,UnsafeRepoUrl)→log.warning('mcp_webhook.deliver_ssrf_blocked',...)+return best-effort
acceptance:
  - 注册 127.0.0.1/169.254.169.254/10.0.0.1/file:// 抛 400
  - 公网 https 注册成功
  - 投递复查私网 url 记 warn 放弃不抛
  - 现有 mcp 测试（修 fixture 后）零回归
verify:
  - cd backend && pytest app/modules/mcp_gateway -q && ruff check app/modules/mcp_gateway/service.py
constraints:
  - brownfield 测试债（必处理）：现有 test_webhook.py _seed_webhook(:133)/CRUD/deliver 用 url="https://hooks.example.com/cb"，hooks.example.com 真实 DNS 不可解析→assert_public_hostname 抛 SsrfBlocked 击穿 ~7 用例
  - 修法：在 test_webhook.py mock app.core.ssrf.assert_public_url（或 ToolPolicyService.assert_public_hostname）返回 None 代表公网放行，SSRF 拒绝路径在 test_webhook_ssrf.py 单测
  - best-effort catch 仅捕 SsrfBlocked/UnsafeRepoUrl 不吞其它异常
---
注册期校验强失败（400），投递期 best-effort 不影响其它 webhook 投递。fixture mock 必做否则现存套件红。
