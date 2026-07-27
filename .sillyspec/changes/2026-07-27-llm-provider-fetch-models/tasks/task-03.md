---
id: task-03
title: fetch-models SSRF 防护（复用 tool_policy + 补 IPv6 + 防阻塞 DNS）
title_zh: fetch-models SSRF 防护（复用+IPv6+防阻塞）
author: qinyi
created_at: 2026-07-27 09:47:54
priority: P0
depends_on: [task-02]
blocks: [task-12]
requirement_ids: [NFR-01]
decision_ids: [D-006]
allowed_paths:
  - backend/app/modules/tool_gateway/tool_policy.py
  - backend/app/modules/llm_provider/service.py
goal: >
  给 task-02 的 fetch_models 加 SSRF 防护：拒绝私网/保留地址、补 IPv6、getaddrinfo 包 asyncio.to_thread 防阻塞事件循环。
implementation:
  - 复用 tool_policy.ToolPolicyService._check_not_private_ip（tool_policy.py 私网 IPv4Network 成员判定，已含 0.0.0.0/8/10/8/172.16/12/192.168/16/127/8/169.254/16），勿另写字符串前缀。
  - 补 IPv6：既有仅 AF_INET；新增 ::1/128、fc00::/7（唯一本地）、fe80::/10（链路本地）判定（ipaddress.IPv6Network，ip in network）。
  - 防阻塞：socket.getaddrinfo 同步调用必 await asyncio.to_thread(...) 包裹（对齐 tool_gateway/service.py:152 整块 to_thread 范式）。
  - 集成点：task-02 fetch_models 在对候选 URL 发 httpx 请求前，先解析域名 IP → 校验私网/保留；解析失败按 SSRF 拒绝（不 fallback）。
  - 抽共享 helper 倾向放 tool_policy.py（既有归属），llm_provider/service.py import 调用；不改 _check_not_private_ip 既有 IPv4 语义，只补 IPv6 分支。
acceptance:
  - 私网/保留 IPv4（10.x/172.16.x/192.168.x/127.x/169.254.x/0.x）被拒。
  - IPv6 私网（::1/fc00::/fe80::）被拒。
  - DNS 解析（getaddrinfo）不阻塞事件循环（to_thread 包裹）。
  - 公网 base_url（如 https://api.anthropic.com）放行。
  - 解析失败（gaierror）按安全侧拒绝，不抛裸 OSError。
verify:
  - cd backend && uv run pytest app/modules/llm_provider -q --no-cov
  - cd backend && uv run mypy app
constraints:
  - 不重复造 SSRF 字符串前缀（复用既有 IPv4Network 列表 + is_reserved 语义，已含 0.0.0.0/8 等）。
  - getaddrinfo 必 asyncio.to_thread 包裹。
  - 不改 tool_policy._check_not_private_ip 既有 IPv4 语义，只补 IPv6。
---
