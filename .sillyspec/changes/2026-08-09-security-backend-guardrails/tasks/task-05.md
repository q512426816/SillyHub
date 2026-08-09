---
id: task-05
title: http_get 逐跳 SSRF 复查（follow_redirects=False 手动 ≤3 跳 + 每跳 assert_public_url + 缺 Location 处理）
title_zh: http_get 逐跳 SSRF 复查
author: qinyi
created_at: 2026-08-09 21:54:41
priority: P0
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-10]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/tool_gateway/service.py
expects_from:
  task-01:
    - contract: assert_public_url
      needs: [url, allowed_schemes]
goal: >
  http_get 改逐跳复查同时修 IPv6 私网绕过 + 重定向不复查两缺口，不动 policy 路径。
implementation:
  - import from app.core.ssrf import assert_public_url
  - _handle_http_get 保留 scheme 白名单
  - 删 follow_redirects=True,max_redirects=3 改手动逐跳循环(≤3跳)：每跳 await assert_public_url(url)→client.get(url,follow_redirects=False)
  - 3xx 取 Location(缺/畸形→return {"result_code":1,"output":"Invalid redirect"})，用 resp.url.join(location) 解析为绝对 url 作下一跳再校验
  - ">3跳终止返回错误；2xx 返回截断 body"
acceptance:
  - "[::1]/[fe80::1]/[fc00::1] 拒"
  - 重定向到 127.0.0.1/169.254.169.254 拒(mock httpx 逐跳)
  - 重定向缺 Location 返 Invalid redirect
  - ≤3跳公网正常
  - 现有 http_get 公网用例零回归
verify:
  - cd backend && pytest app/modules/tool_gateway -q && ruff check app/modules/tool_gateway/service.py
constraints:
  - 不动 tool_policy.py / _check_not_private_ip（D-005，handler 逐跳已覆盖 IPv6+重定向，policy IPv4 冗余门保留）
  - 跨平台
---
逐跳循环把校验从"入口一次"改为"每跳一次"，DNS 重绑定与 IPv6 私网绕过同时堵死。
