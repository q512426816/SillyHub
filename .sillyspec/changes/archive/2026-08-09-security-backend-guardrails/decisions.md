---
author: qinyi
created_at: 2026-08-09T20:49:11
---
# 决策记录（Decisions）— 2026-08-09-security-backend-guardrails

本文件是本次变更的决策台账（非长期术语表）。只记录有实现/验收影响的决策。来源：CONCERNS.md「2026-08-08 多代理审计」🔴 高危（incident 状态机、SSRF 三连）+ 前次会话用户锁定决策 + 本次方案选定。

---

## D-001@v1 — incident 转换图用「放宽版」

- **type**: design
- **status**: accepted
- **source**: 前次会话用户锁定 + 本次 step4 方案对比
- **question**: incident 状态机应采用哪种转换图？严格线性（open→investigating→mitigated→resolved 单向）还是放宽版？
- **answer**: 采用放宽版。任意非终态状态均可直进 resolved（保现有 open→resolved 测试绿 + 实务中「误报/已知问题直关」常见）；resolved 仅可重开回 investigating，不可退回 open/mitigated。
- **normalized_requirement**: 定义 INCIDENT_TRANSITIONS = {open:{investigating,resolved}, investigating:{mitigated,open,resolved}, mitigated:{resolved,investigating}, resolved:{investigating}}。复用 ppm/common/fsm.py assert_transition 校验，非法迁移抛 InvalidTransition(422)。
- **impacts**: incident/service.py update() 插入转换校验；新增/保留测试须覆盖图内所有合法边 + 关键非法边。
- **evidence**: incident/tests/test_service.py + test_router.py 现有用例仅 open→investigating、open→resolved 两种迁移，均在放宽版图内（step2 核实，零破坏）。
- **priority**: P0

## D-002@v1 — resolved 重开时清空 resolved_at / resolved_by

- **type**: design
- **status**: accepted
- **source**: 前次会话用户锁定
- **question**: 已解决的 incident 重开（resolved→investigating）时，残留的解决时间/解决人怎么处理？
- **answer**: 重开时自动清空 resolved_at=None、resolved_by=None。避免「状态已是排查中但还挂着旧解决记录」的脏数据。
- **normalized_requirement**: update() 中当 incident.status=="resolved" 且 target!="resolved" 时，先清空两字段再赋新状态。
- **impacts**: incident/service.py update() 分支；新增测试 test_reopen_clears_resolution_fields。
- **evidence**: CONCERNS.md:124 「resolved 回退 open 不清 resolved_at/resolved_by」属同类脏数据问题。
- **priority**: P0

## D-003@v1 — SSRF 统一入口 app/core/ssrf.py 作 façade（复用 tool_policy 原语，不整体搬迁）

- **type**: architecture
- **status**: accepted
- **source**: 本次 step4 用户选定方案 A
- **question**: SSRF 校验代码组织：新建统一入口复用现有原语 / 把 IP 原语整体搬到 core / 三处各自内联？
- **answer**: 新建 app/core/ssrf.py 作统一入口（assert_public_url 全量 SSRF + assert_safe_repo_url 纯 scheme），内部复用 tool_gateway.tool_policy 的 assert_public_hostname（IPv4+IPv6+asyncio.to_thread，llm-provider 已落地并测过）。不整体搬迁 IP 原语到 core。
- **normalized_requirement**: app/core/ssrf.py 导入 ToolPolicyService + SsrfBlocked；mcp_gateway / tool_gateway(http_get) / worktree 三出站点经此入口校验。UnsafeRepoUrl(AppError, 400) 定义在 core/ssrf.py。
- **impacts**: 新增 app/core/ssrf.py；不改动 tool_policy.py 内部（零回归 tool_gateway 测试）；llm_provider 不受影响。
- **evidence**: tool_policy.assert_public_hostname(service.py:510/probe.py:89 已被 llm_provider 跨模块引用，先例成立)；方案 B(整体搬)动 tool_policy 内部+回归其测试，超「修漏洞」范围；方案 C(三处内联)重复三份难维护。
- **priority**: P0

## D-004@v1 — worktree clone 只禁危险协议，放行内网 git（不查 IP）

- **type**: design
- **status**: accepted
- **source**: 前次会话用户锁定
- **question**: worktree clone 的 repo_url 校验范围：是否要像 mcp/http_get 那样禁止内网 IP？
- **answer**: 不查 IP。只做协议白名单：放行 https/ssh/git 协议 + scp-like 简写（git@host:path）；显式拒 ext::（git remote helper，可 RCE）、file://（读本地文件）、裸本地路径。允许内网 git 服务器（企业内网自建 git 常见）。
- **normalized_requirement**: assert_safe_repo_url(repo_url) 纯 urllib 解析，不调 assert_public_hostname。非法抛 UnsafeRepoUrl(400)。
- **impacts**: worktree/git_runner.py clone_bare 前置校验；新增测试 ext::/file:///abs 被拒、https/ssh/git@host:path 放行。
- **evidence**: 与 mcp/http_get（全量 SSRF 查 IP）刻意区分——worktree clone 目标是企业代码仓库，内网 git 合法；mcp/http_get 目标是外部回调/任意 URL，需查 IP。
- **priority**: P0

## D-005@v1 — http_get 改逐跳复查（同时修 IPv6 + 重定向两缺口），不动 policy 路径

- **type**: design
- **status**: accepted
- **source**: 本次 step2 grounding 发现 + step4 方案
- **question**: http_get 的 IPv6 私网绕过 + 重定向不复查两缺口，改 policy 路径(_check_not_private_ip)还是 handler(_handle_http_get)？
- **answer**: 只改 handler _handle_http_get：把 follow_redirects=True 改成 follow_redirects=False 手动逐跳跟 3xx（≤3 跳），每跳 await assert_public_url(url)（含 IPv4+IPv6 全量 SSRF）再请求。不动 policy 路径的 _check_not_private_ip（IPv4-only 保留作冗余前置门，避免改动 tool_policy 测试）。
- **normalized_requirement**: _handle_http_get 重写请求循环：scheme 白名单(已有) + 逐跳 assert_public_url + 手动 Location 跟随 ≤3 跳。
- **impacts**: tool_gateway/service.py _handle_http_get；不动 tool_policy.py；新增测试 [::1]/fe80:: 拒、重定向到 127.0.0.1 拒。
- **evidence**: assert_public_url 底层 assert_public_hostname 已 IPv4+IPv6，逐跳复查天然覆盖两缺口；policy _check_not_private_ip 是请求前的 IPv4 冗余门，保留无害且避免回归 tool_gateway 测试。
- **priority**: P0

## D-006@v1 — 非法状态值仍 400，非法转换 422，两道门顺序固定

- **type**: design
- **status**: accepted
- **source**: 本次设计（保 test_update_invalid_status 绿）
- **question**: update() 里「值非法」(如 status="unknown") 与「转换非法」(如 open→mitigated) 谁先校验、各返什么码？
- **answer**: 先校验值 ∈ VALID_STATUSES（非法 → IncidentError 400，保 test_update_invalid_status:164 绿）；值合法但转换非法 → assert_transition → InvalidTransition 422。同状态幂等（open→open）跳过转换校验直接放行。
- **normalized_requirement**: update() 顺序：① status not None → ② 值∈VALID_STATUSES?(否→400) → ③ status!=当前?(否→跳过) → ④ assert_transition(否→422) → ⑤ 进/出 resolved 字段维护 → ⑥ 赋值。
- **impacts**: incident/service.py update()；test_update_invalid_status 保持 400、新增转换 422 用例。
- **evidence**: test_service.py:164 断言 IncidentError(match="Invalid status")，须保 400 而非 422。
- **priority**: P1
