---
author: qinyi
created_at: 2026-08-09T20:49:11
---
# 任务（Tasks）— 后端防护加固：incident 状态机转换校验 + SSRF 三连

> 串行 3 安全 change 之 2。文件清单见 design.md §6。每 task 自带验收锚点（AC）。execute 阶段逐 task 实现 + 单测；改后端代码的 task 提交前须 `ruff format`（pre-commit hook 拦截）。不碰 OpenAPI/DTO/migration → 无需 gen:types。

---

## task-01 · 新建 SSRF 统一入口 app/core/ssrf.py
**改**：新增 `backend/app/core/ssrf.py`。
- `class UnsafeRepoUrl(AppError)`：code=`HTTP_400_UNSAFE_REPO_URL`、http_status=400。
- `async def assert_public_url(url, *, allowed_schemes=("http","https"))`：urlparse 校 scheme（非法抛 UnsafeRepoUrl）→ 取 hostname → `await ToolPolicyService.assert_public_hostname(host)`（私网/不可解析抛 SsrfBlocked）。
- `def assert_safe_repo_url(repo_url)`：纯协议白名单（不查 IP）。规则（D-004 + Grill P2-1）：
  - 空 → 抛；
  - 以 `ext::` 开头 → 抛；
  - 含 `://`：urlparse.scheme ∈ {https, ssh, git} 放行，否则抛；
  - scp-like（无 `://` 且含 `:`）：取首个 `:` 前 token，须匹配 hostname 字符类 `^[A-Za-z0-9.@-]+$` 且长度 ≥2（挡 Windows 单字母盘符 `C:\foo`/`C:/foo`），放行；否则抛；
  - 其余（裸路径 /abs、./rel、..）→ 抛。
  - import `from app.modules.tool_gateway.tool_policy import SsrfBlocked, ToolPolicyService`。
**验收**：模块可导入无循环（`python -c "import app.core.ssrf"`）；AC-6/7/9 的单元断言可基于此模块先写纯函数测试。
**关联**：FR-07/08/10、D-003/004、文件清单第 1 行。

## task-02 · incident 状态机转换校验
**改**：`backend/app/modules/incident/service.py`。
- 模块级加 `INCIDENT_TRANSITIONS`（design §7）紧邻 `VALID_STATUSES`。
- import `from app.modules.ppm.common.fsm import assert_transition`。
- update() 的 status 分支（:106-117）按 D-006 顺序重写：值校验(400) → 同状态幂等(跳过) → `assert_transition`(422) → 进/出 resolved 字段维护（进 resolved 写 resolved_at/by；离开 resolved 清两字段）→ 赋值。
- severity/description/root_cause/resolution 分支不动。
**验收**：AC-1~5；现有 test_service.py / test_router.py 全绿。
**关联**：FR-01~06、D-001/002/006、文件清单第 2 行。

## task-03 · mcp webhook SSRF 双查
**改**：`backend/app/modules/mcp_gateway/service.py`。
- import `from app.core.ssrf import assert_public_url` + `from app.modules.tool_gateway.tool_policy import SsrfBlocked`（catch 用；UnsafeRepoUrl 一并 catch）。
- create()（:412-443）：构造 ORM 行前 `await assert_public_url(url.strip())`，异常传播 → 全局 400。
- _deliver_one()（:534-552）：client.post 前 `await assert_public_url(webhook.url)`，包进现有 try，catch (SsrfBlocked, UnsafeRepoUrl) → `log.warning("mcp_webhook.deliver_ssrf_blocked", ...)` + return（best-effort，不重试不抛）。
**验收**：AC-7/8；现有 mcp webhook 正常投递测试零回归。
**⚠️ brownfield 测试债（plan-review #8 发现，开工前必处理）**：现有 `mcp_gateway/tests/test_webhook.py` 的 `_seed_webhook`(:133) 与 CRUD/deliver 测试用 `url="https://hooks.example.com/cb"`——`hooks.example.com` 是 IANA 保留域子域、**真实 DNS 不可解析**，task-03 在 create() 前置 `assert_public_url` 后 `assert_public_hostname` 会做真实 DNS 解析抛 SsrfBlocked，击穿 ~7 条既有用例（6 deliver + 1 CRUD 成功）。**修法**：改 fixture 用可解析公网域（如 `https://public.example.org` 仍可能不解析，更稳是 mock）→ 最稳是在现有 test_webhook.py 与新 test_webhook_ssrf.py 里 **mock `app.core.ssrf.assert_public_url` 或 `ToolPolicyService.assert_public_hostname`** 返回 None（公网放行），SSRF 拒绝路径单独用「mock 抛 SsrfBlocked」测。test_webhook.py 与 test_webhook_ssrf.py 纳入 task-03/07 allowed_paths。
**关联**：FR-08/09、D-003、文件清单第 3 行。

## task-04 · worktree clone 协议白名单
**改**：`backend/app/modules/worktree/git_runner.py`。
- import `from app.core.ssrf import assert_safe_repo_url, UnsafeRepoUrl`（UnsafeRepoUrl 用于类型，实际抛在 helper 内）。
- clone_bare()（:68-87）：`_run([clone,--bare,...])` 前 `assert_safe_repo_url(repo_url)`，非法抛 UnsafeRepoUrl(400)。
**验收**：AC-6；execute 前 grep 现存 repo_url 数据/种子确认无 file:///裸路径（R-05）。
**关联**：FR-07、D-004、文件清单第 4 行。

## task-05 · http_get 逐跳 SSRF 复查
**改**：`backend/app/modules/tool_gateway/service.py` _handle_http_get（:523-566）。
- import `from app.core.ssrf import assert_public_url`。
- 保留 scheme 白名单（:544-546）。
- 删 `follow_redirects=True, max_redirects=3`（:550），改手动逐跳循环（≤3 跳）：每跳 `await assert_public_url(url)` → `client.get(url, follow_redirects=False)`；3xx 取 Location（缺/畸形 → return `{"result_code":1,"output":"Invalid redirect"}`），用 `resp.url.join(location)` 解析为绝对 url 作下一跳再校验；>3 跳终止返回错误；2xx 返回 body（截断逻辑不变）。
**验收**：AC-9；现有 http_get 公网用例零回归。
**关联**：FR-10、D-005、文件清单第 5 行。

## task-06 · 测试：incident 转换校验（test_fsm.py）
**改**：新增 `backend/app/modules/incident/tests/test_fsm.py`。
- 合法边全覆盖：open→investigating、open→resolved、investigating→mitigated、investigating→open、investigating→resolved、mitigated→resolved、mitigated→investigating、resolved→investigating。
- 非法边拒 422：open→mitigated、mitigated→open、resolved→open、resolved→mitigated。
- 重开清字段：resolved→investigating 后 resolved_at/resolved_by 均空（FR-04）。
- 同状态幂等：open→open 不报错（FR-05）。
- resolved→resolved 幂等不刷新 resolved_at（Design Grill P2-3，新增断言）。
- 值非法仍 400（FR-03，可与 test_update_invalid_status 互补，不强求重复）。
**验收**：AC-1/3/4/5；ruff format。
**关联**：FR-01~06。

## task-07 · 测试：SSRF 三连（test_ssrf.py / test_webhook_ssrf.py / test_repo_url_guard.py）
**改**：新增三个测试文件。
- `tool_gateway/tests/test_ssrf.py`：http_get [::1]/[fe80::1]/[fc00::1] 拒；重定向到 127.0.0.1/169.254.169.254 拒（mock httpx 逐跳：首跳公网 302→Location 私网）；重定向缺 Location 返 Invalid redirect；≤3 跳公网正常。
- `mcp_gateway/tests/test_webhook_ssrf.py`：create 注册 127.0.0.1/169.254.169.254/10.0.0.1/file:// 抛 400；公网 https 注册成功；_deliver_one 复查私网 url 记 warn 放弃不抛（mock assert_public_url 或 mock httpx）。
- **DNS mock 纪律（防 flaky，change-1 教训）**：SSRF 公网放行路径 mock `assert_public_hostname`/`assert_public_url` 返回 None（不依赖真实 DNS）；拒绝路径用「mock 抛 SsrfBlocked/UnsafeRepoUrl」或纯字符串断言（assert_safe_repo_url 是纯函数直接测，不经 DNS）。同时修现有 test_webhook.py 的 `hooks.example.com` fixture（见 task-03 brownfield 债）。
- `worktree/tests/test_repo_url_guard.py`：assert_safe_repo_url 纯函数测试——放行 https://x/git://x/ssh://x/git@host:path/host.xz:path；拒绝 ext::x/file:///abs//abs/./rel/../C:\foo/C:/foo/空/单字母 X:foo。clone_bare 集成：ext:: 抛 UnsafeRepoUrl 不调 git。
**验收**：AC-6/7/8/9；DNS 类用 mock（避免真实解析 flaky）；ruff format。
**关联**：FR-07/08/09/10 + Grill P2-1（C:\foo 拒）。

## task-08 · 文档收尾（CONCERNS + 模块变更索引）
**改**：
- `.sillyspec/docs/SillyHub/scan/CONCERNS.md`：incident 状态机条目（:81）标 ✅ 已修复(change 2026-08-09-security-backend-guardrails)；SSRF 三连条目（:65/66/67）标 ✅ 已修复 + 修复手段摘要。
- `backend.md` 变更索引追加 change 2026-08-09-security-backend-guardrails 条目（incident FSM + core/ssrf + 三出站点）。
**验收**：只动本变更相关条目（PPM 冒名属 change 3 不碰）。
**关联**：NFR-01 文档同步。

---

## 执行顺序
task-01（ssrf 入口）→ task-02（incident，独立可并行）→ task-03/04/05（三出站点接入，依赖 task-01）→ task-06/07（测试）→ task-08（文档）。task-02 与 task-01 无依赖可并行；task-03/04/05 依赖 task-01 的 helper。
