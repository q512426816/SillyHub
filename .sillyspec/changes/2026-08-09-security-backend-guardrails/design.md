---
author: qinyi
created_at: 2026-08-09
scale: large
---
# 设计文档（Design）— 后端防护加固：incident 状态机转换校验 + SSRF 三连

## 1. 背景

CONCERNS.md「2026-08-08 多代理审计」🔴 高危列出后端两个入口校验缺失类问题，本 change 修其中两项（第 3 项 PPM 冒名单独成 change 3）：

- **incident 状态机无转换校验**（`incident/service.py:99-138`）：`update()` 仅校验 status 值 ∈ 合法集合（`VALID_STATUSES`），不校验「能否从当前状态跳到目标状态」。后果：任意两个状态可互跳，终态 `resolved` 能被改回 `open`/`investigating`/`mitigated` 且不清解决记录 → 故障生命周期数据失真、终态可复活。CONCERNS.md:81 标注「severity 校验已补（ql-20260809-003），status 转换校验仍待办」。
- **SSRF 三连**：三个「让后端替用户发外部请求」的入口缺校验或校验不全：
  - mcp webhook 回调（`mcp_gateway/service.py`）：注册 url 与投递 url 均无 scheme/私网校验，可注册指向 `169.254.169.254`（云元数据）/`127.0.0.1`/内网的回调（CONCERNS.md:65）。
  - worktree git clone（`worktree/git_runner.py:78-79`）：`repo_url` 零校验，`ext::` 协议可 backend 容器内 RCE、`file://` 可读本地文件（CONCERNS.md:66）。
  - http_get 工具（`tool_gateway/service.py:549-552`）：`follow_redirects=True` 重定向后不复查 + SSRF 私网检查走 policy 路径 `_check_not_private_ip`（IPv4-only AF_INET），不挡 IPv6 私网（`::1`/`fc00::`/`fe80::`）+ 重定向绕过（CONCERNS.md:67）。

底层「解析域名→判内网 IP」原语（`tool_policy.assert_public_hostname`，IPv4+IPv6+`asyncio.to_thread` 防 DNS 阻塞）此前 llm-provider change 已落地并测过，本次复用，不重复造轮子。

## 2. 设计目标

- incident：加合法转换校验（放宽版图），终态不可任意复活、重开清解决记录、非法转换返 422、现有测试零破坏。
- SSRF：建统一入口 `app/core/ssrf.py`，三出站点（mcp webhook / worktree clone / http_get）经此校验；堵住 IPv6 私网、重定向、危险协议三类绕过。
- 兼容现有功能：现有 incident 测试与页面（仅 open→investigating、open→resolved）零影响；现有 tool_gateway / mcp_gateway 正常公网用例零影响。

## 3. 非目标（防止 scope creep）

- **不做** incident 状态机 UI/前端改造（后端校验足够，前端按现有交互）。
- **不做** 把 IP 原语整体从 tool_policy 搬到 core（D-003，留 follow-up D-item，本 change 控范围）。
- **不做** policy 路径 `_check_not_private_ip` 的 IPv6 升级（D-005，handler 逐跳复查已覆盖，动 policy 路径徒增回归面）。
- **不做** PPM 冒名填报防护（属 change 3，已上线模块单独隔离）。
- **不做** incident 时间戳 `utcnow()` → `now(UTC)` 统一（CONCERNS.md:124 🟢 低，与本 change 无关）。
- **不碰** OpenAPI schema / DTO 输出（均为内部逻辑校验，无对外字段变动 → 无需 gen:types）。

## 4. 拆分判断

3 个安全 change 串行（用户锁定，CLAUDE.md 规则 18 隔离）：change 1（凭据卫生，已完成）→ **change 2（本变更，incident+SSRF，未上线后端）** → change 3（PPM 冒名，已上线谨慎）。本 change 内 2 项修复文件完全不重叠（incident 模块 vs core+网关模块），可同一 change 内并行推进、统一验收。

## 5. 总体方案

### Phase A — incident 状态机转换校验（D-001/002/006）

**A1. 定义转换图**（incident/service.py 模块级，紧邻 `VALID_STATUSES`）：

```python
INCIDENT_TRANSITIONS: dict[str, set[str]] = {
    "open":          {"investigating", "resolved"},      # 排查 / 误报直关
    "investigating": {"mitigated", "open", "resolved"},  # 退回 / 控制 / 直收
    "mitigated":     {"resolved", "investigating"},      # 收尾 / 回查
    "resolved":      {"investigating"},                  # 仅可重开
}
```

**A2. update() 插入转换校验**（service.py:106-117 重写 status 分支）。校验顺序固定（D-006）：

1. `data.status is not None` 进入分支；
2. 值校验：`data.status not in VALID_STATUSES` → `IncidentError(400)`（保 test_update_invalid_status 绿）；
3. 同状态幂等：`data.status == incident.status` → 跳过转换校验与字段维护（但仍赋值，幂等 no-op）；
4. 转换校验：`assert_transition(incident.status, data.status, INCIDENT_TRANSITIONS, entity="incident", entity_id=incident.id)` → 非法抛 `InvalidTransition(422)`；
5. resolved 字段维护：进 `resolved` 设 `resolved_at=now`+`resolved_by`；**离开** `resolved`（当前 resolved 且目标非 resolved）清 `resolved_at=None`+`resolved_by=None`（D-002 重开清字段）；
6. 赋值 `incident.status = data.status`。

severity / description / root_cause / resolution 分支不动。import：`from app.modules.ppm.common.fsm import assert_transition` + `from app.core.errors import InvalidTransition`（fsm 内部已抛 InvalidTransition，service 无需直接 raise）。

**A3. router 零改动**：`update_incident`（router.py:78-86）仅调 `svc.update`，`InvalidTransition` 是 AppError 子类（http_status=422），由 `core/errors.register_exception_handlers` 全局映射，无需 router 捕获。

### Phase B — SSRF 统一入口与三出站点接入（D-003/004/005）

**B1. 新建 `app/core/ssrf.py`**（统一入口，façade 复用 tool_policy 原语）：

```python
from urllib.parse import urlparse
from fastapi import status
from app.core.errors import AppError
from app.modules.tool_gateway.tool_policy import SsrfBlocked, ToolPolicyService

class UnsafeRepoUrl(AppError):
    code = "HTTP_400_UNSAFE_REPO_URL"
    http_status = status.HTTP_400_BAD_REQUEST

async def assert_public_url(url: str, *, allowed_schemes: tuple[str, ...] = ("http", "https")) -> None:
    """全量 SSRF：scheme 白名单 + 解析 host + assert_public_hostname（IPv4+IPv6）。
    非法 scheme 抛 UnsafeRepoUrl；host 解析到私网/不可解析抛 SsrfBlocked（均 400）。"""
    parsed = urlparse(url)
    if parsed.scheme not in allowed_schemes:
        raise UnsafeRepoUrl(f"Unsupported URL scheme: {parsed.scheme}", details={"url": url, "scheme": parsed.scheme})
    host = parsed.hostname
    await ToolPolicyService.assert_public_hostname(host)   # 空 host/不可解析/私网 → SsrfBlocked

def assert_safe_repo_url(repo_url: str) -> None:
    """git 仓库 URL 协议白名单（不查 IP，允许内网 git）。放行 scp-like 与 https/ssh/git；拒 ext::/file:::/裸路径。"""
    # 见 §7 接口定义完整实现
```

**B2. mcp webhook 双查**（mcp_gateway/service.py）：
- `create()`（:412-443）：构造 ORM 行前 `await assert_public_url(url.strip())`，SsrfBlocked/UnsafeRepoUrl 传播 → 全局 400。
- `_deliver_one()`（:534-552）：`client.post`（:552）前 `await assert_public_url(webhook.url)`，包在现有 try 内、catch SsrfBlocked/UnsafeRepoUrl → `log.warning` + `return`（best-effort，不重试不抛，对齐 :535-541 现有语义）。防注册后 DNS 重绑定/解析变更。
- import：`from app.core.ssrf import assert_public_url` + `from app.modules.tool_gateway.tool_policy import SsrfBlocked`（仅用于 catch）。

**B3. worktree clone 协议白名单**（worktree/git_runner.py clone_bare :68-87）：`_run([clone,--bare,...])`（:78-79）前调 `assert_safe_repo_url(repo_url)`，非法抛 `UnsafeRepoUrl(400)`。import：`from app.core.ssrf import assert_safe_repo_url`。

**B4. http_get 逐跳复查**（tool_gateway/service.py _handle_http_get :523-566）：scheme 白名单（:544-546 已有）保留；删 `follow_redirects=True, max_redirects=3`（:550），改手动逐跳循环（≤3 跳）：每跳 `await assert_public_url(url)` → `client.get(url, follow_redirects=False)`；3xx 取 `resp.headers["location"]`（相对路径用 `resp.url` join）作下一跳 url 再校验；>3 跳或非 3xx 终止。底层 assert_public_hostname 已 IPv4+IPv6，逐跳复查天然修 IPv6 + 重定向两缺口（D-005）。import：`from app.core.ssrf import assert_public_url`。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/app/core/ssrf.py` | SSRF 统一入口：`assert_public_url`(全量) + `assert_safe_repo_url`(协议) + `UnsafeRepoUrl`(400)；façade 复用 tool_policy 原语（D-003）。仅内部逻辑，无对外字段 |
| 修改 | `backend/app/modules/incident/service.py` | 模块级加 `INCIDENT_TRANSITIONS`；update() status 分支插入转换校验+重开清字段（A2）；import assert_transition。无对外字段变动 |
| 修改 | `backend/app/modules/mcp_gateway/service.py` | create() 注册前 + _deliver_one 投递前 `assert_public_url`（B2）。无对外字段变动 |
| 修改 | `backend/app/modules/worktree/git_runner.py` | clone_bare 前 `assert_safe_repo_url`（B3）。无对外字段变动 |
| 修改 | `backend/app/modules/tool_gateway/service.py` | _handle_http_get 改逐跳复查 assert_public_url（B4）。无对外字段变动 |
| 新增 | `backend/app/modules/incident/tests/test_fsm.py` | incident 转换校验新用例（A 验收） |
| 新增 | `backend/app/modules/tool_gateway/tests/test_ssrf.py` | http_get SSRF 新用例（IPv6/重定向，B4 验收） |
| 新增 | `backend/app/modules/mcp_gateway/tests/test_webhook_ssrf.py` | mcp webhook SSRF 新用例（B2 验收） |
| 新增 | `backend/app/modules/worktree/tests/test_repo_url_guard.py` | clone repo_url 协议白名单新用例（B3 验收） |

> 字段数据流：本 change 无新增/修改对外字段、DTO、响应体、事件 payload、配置键（均为内部校验逻辑），故无 producer→consumer 数据流标注。incidental：`assert_public_url`/`assert_safe_repo_url` 为内部函数，无对外契约。

## 7. 接口定义

```python
# app/core/ssrf.py
class UnsafeRepoUrl(AppError):          # code="HTTP_400_UNSAFE_REPO_URL", http_status=400
    ...

async def assert_public_url(url: str, *, allowed_schemes: tuple[str, ...] = ("http", "https")) -> None:
    """全量 SSRF 校验。raise UnsafeRepoUrl(scheme 非法) | SsrfBlocked(host 私网/不可解析)。"""

def assert_safe_repo_url(repo_url: str) -> None:
    """git repo URL 协议白名单（同步、不查 IP）。raise UnsafeRepoUrl。
    规则（D-004）：
      - 以 'ext::' 开头 → 拒（git remote helper，RCE）
      - 含 '://'：urlparse.scheme ∈ {https, ssh, git} 放行；file / 其它 → 拒
      - scp-like（无 '://'、含 ':' 且首个 ':' 前无 '/'，如 git@host:path / host:path）→ 放行
      - 其余（裸路径 /abs、./rel、..、空）→ 拒（视同 file）
    """

# incident/service.py 模块级
INCIDENT_TRANSITIONS: dict[str, set[str]] = {
    "open": {"investigating", "resolved"},
    "investigating": {"mitigated", "open", "resolved"},
    "mitigated": {"resolved", "investigating"},
    "resolved": {"investigating"},
}
# update() status 分支伪码见 §5 A2
```

## 7.5 生命周期契约表

本 change 涉及 `state transition`（incident 状态机），必填。incident 状态生命周期契约：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create incident | 前端/API 调用方 | IncidentService.create | title, severity | （无）→ open |
| update status（合法转换） | 前端/API 调用方 | IncidentService.update | status(target) | 当前 → 目标（须在 INCIDENT_TRANSITIONS 白名单） |
| resolve | 前端/API 调用方 | IncidentService.update | status="resolved", resolved_by? | 非终态 → resolved（写 resolved_at/by） |
| reopen | 前端/API 调用方 | IncidentService.update | status="investigating" | resolved → investigating（清 resolved_at/by） |
| update status（非法转换） | 前端/API 调用方 | IncidentService.update | status(target) | 拒绝 → InvalidTransition(422)，状态不变 |

> 表中事件均映射到 `IncidentService.create`/`update` 代码任务 + test_fsm 测试任务。必需字段 `status` 已在现有 `IncidentUpdate` schema 中（无新增字段）。

## 8. 数据模型

无表结构/字段变更。incident 现有 `status`/`resolved_at`/`resolved_by` 字段不变，仅改 update() 写入逻辑。无 migration。

## 9. 兼容策略（brownfield）

- **incident 现有用例零影响**：现有测试与页面仅用 open→investigating、open→resolved（step2 核实 test_service.py:106/142/155/185/227、test_router.py:116/135），均在放宽版图内。test_update_invalid_status 仍 400（D-006 顺序）。
- **mcp/http_get 公网用例零影响**：assert_public_url 对公网 http/https 域名放行（assert_public_hostname 仅拒私网/不可解析）。
- **worktree clone 现有 repo_url 零影响**：白名单 https/ssh/git + scp-like 覆盖所有正常 git 远端形式；execute 前将 grep 现存 repo_url 数据确认无 file:///裸路径形式（防回归，D-004 evidence）。
- **不改变的 API/表**：所有 DTO、响应体、表结构、migration 不变；无对外契约变动。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | incident 放宽版图意外阻断某既有合法业务跳转 | P1 | step2 已逐一核对现有测试/页面仅 2 种跳转；test_fsm 覆盖图内全部合法边 + execute 跑全量 incident 测试回归 |
| R-02 | core/ssrf.py import tool_policy 造成循环导入或拖入 ToolPolicy ORM 表注册 | P2 | tool_policy 不 import core/ssrf（无环）；ToolPolicy 表本就由 conftest/migrations 全局注册，运行期无额外代价；execute 跑导入冒烟 |
| R-03 | assert_safe_repo_url 的 scp-like 判定误伤合法 git URL（如带端口的 ssh:// 或新式 URL） | P2 | 规则保守：含 `://` 走 urlparse scheme 白名单（ssh:// 放行）；仅「无 :// 的 host:path」走 scp-like；test_repo_url_guard 覆盖 https/ssh/git/git@host:path/带端口 各放行 + ext::/file:///裸路径 拒 |
| R-04 | http_get 逐跳循环对畸形 Location（相对路径/循环重定向）处理不当致 hang | P2 | ≤3 跳硬上限 + 相对路径用 httpx.Response.url.join 解析 + 每跳 assert_public_url（私网拒）；超 3 跳返回结果码错误不 hang |
| R-05 | worktree 现存 repo_url 数据含 file:// 形式，加校验后既有工作区克隆失败 | P2 | execute 前 grep `repo_url` 字段数据/种子/测试确认无 file:///裸路径；若发现按 D-004 评估（企业场景应全 https/ssh） |
| R-06 | mcp _deliver_one best-effort catch 范围误吞非 SSRF 异常 | P2 | 仅 catch SsrfBlocked/UnsafeRepoUrl，其它异常维持原重试语义（:562-569）不吞 |

## 11. 决策追踪

本 change 当前版本决策（详见 decisions.md）：

- **D-001@v1** incident 放宽版转换图 → §5 A1 / §7 INCIDENT_TRANSITIONS / requirements FR-01~03
- **D-002@v1** resolved 重开清字段 → §5 A2 step5 / requirements FR-04
- **D-003@v1** SSRF 统一入口 façade（不搬原语） → §5 B1 / 文件清单 core/ssrf.py
- **D-004@v1** worktree 只禁危险协议放行内网 git → §5 B3 / §7 assert_safe_repo_url / requirements FR-07
- **D-005@v1** http_get 逐跳复查不动 policy 路径 → §5 B4 / requirements FR-09/10
- **D-006@v1** 非法值 400 / 非法转换 422 / 同状态幂等 → §5 A2 / requirements FR-05/06

未解决/遗留：D-003 的「整体搬 IP 原语到 core」列 follow-up（本 change 不做，R-02 已评估可接受）。

## 12. 自审

- ✅ 章节齐全：背景/目标/非目标/拆分/总体方案/文件清单/接口定义/生命周期契约表/数据模型/兼容/风险/决策/自审。
- ✅ 生命周期契约表已含（state transition 关键词触发），5 事件均映射到代码+测试任务。
- ✅ 引用全部当前版本决策 D-001~D-006（§11），decisions.md 每条均含 normalized_requirement + impacts。
- ✅ 文件清单 9 项，每项说明列已交代改动性质（无对外字段 → 无数据流标注，已声明）。
- ✅ 现有测试零破坏已核实（R-01 evidence：step2 逐行核对 incident 测试）。
- ✅ 不碰 OpenAPI/DTO/migration（§3 非目标 + §8 无数据模型变更），无需 gen:types。
- ⚠️ 自审存疑：assert_safe_repo_url 的 scp-like 精确判定边界（首个 `:` 前有无 `/`）需 execute 时用真实 git URL 形态验证（R-03 已登记 + test 覆盖）。
- ✅ 兼容 Windows/Linux/macOS：纯 Python（urllib/ipaddress/asyncio），无平台特定代码。
