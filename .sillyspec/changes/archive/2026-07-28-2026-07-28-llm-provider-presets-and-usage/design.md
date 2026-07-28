---
author: qinyi
created_at: 2026-07-28 10:06:36
scale: large
revision: 1
---

# 设计文档（Design）— LLM 供应商：预设模版 + 用量查询

## 1. 背景

「我的供应商」模块（参考 cc-switch 已落地：CRUD + set/unset-default「启动/停止」+ fetch-models 拉上游 `/v1/models` + `settings_config` JSON 配置）当前缺两个能力：

1. **每次新建供应商都要手填** base_url / 认证字段 / 默认模型，国内常用中转站反复重复劳动，且容易填错。
2. **看不到每个供应商剩多少额度/余额**，用超或欠费了才知道，没法提前预警。

参考 cc-switch（`C:\Users\qinyi\IdeaProjects\cc-switch`）补这两块：① 预设供应商模版（点预设一键填表单）；② 用量查询（后端代查余额，前端展示）。

## 2. 设计目标

- **预设模版**：内置 10 家常用 claude 风格供应商，点预设一键填好 base_url / 认证字段 / 默认模型 / 官网，用户只剩 API Key 要手填。
- **用量查询**：后端代查供应商余额/套餐额度，前端列表 inline 展示（支持多窗口 tier：5 小时窗/周限额/月限额），手动「查余额」按钮 + 进页面自动查一次。

## 3. 非目标（Non-Goals）

- **不做官方订阅查询**（Claude/Codex/Gemini 官方订阅额度）——需读用户本机 CLI 登录凭据（Keychain/凭据文件），Web 后端没有，云端不可行。
- **不做 GitHub Copilot 用量**——需 OAuth 托管。
- **不做自定义 JS 脚本查询**——cc-switch 用 QuickJS 沙箱，Python 无对等物；第一版只硬编码固定几家。
- **百炼 / Bailian For Coding 不做用量查询**——阿里云 DashScope 余额查询需账号 AK/SK HMAC 签名（控制面 API），cc-switch 亦未实现；这两家只做预设。
- **Anthropic 官方不做用量查询**（属官方订阅路径，砍）。
- **不改 `agent_kind`**（仍仅 claude）、**不改下发链路 / daemon / lease**。
- **不做后台定时自动刷新**（仅手动 + 进页面自动查一次）。
- **不做预设的后端存储 / seed**（预设纯前端常量，后端不存预设数据）。
- **反代 / Header 覆盖 / API 格式转换不做**（沿用既有 D-012 非目标）。

## 4. 拆分判断

- 两个功能（预设 / 用量）放**一个 change、两个 Wave**，不强制拆分：都聚焦 `llm_provider` 模块、共用前端 list/form、Wave B 复用 Wave A 预设带的「这家能否查用量」标识。不满足「3+ 独立可交付模块」的强制拆分条件。
- **不走批量模式**：预设是 10 家静态配置（一个常量文件的数据），用量是 7 家 × 2 条路径的硬编码 handler（有限、<10 个有效独立任务），本质不是「模板 × 大批量数据」。

## 5. 总体方案

### Wave A · 预设模版（纯前端，零后端改动）

- 新建 `frontend/src/config/llmProviderPresets.ts`：导出 10 家预设常量 + `LlmProviderPreset` 类型。每个预设含 `key / name / category / base_url / auth_field / default_model / website_url / api_key_url? / usage?（templateType 标记，前端展示「💰 可查用量」用）/ icon? / icon_color?`。
  - `settings_config` 预填：claude 风格即 `{ env: { ANTHROPIC_BASE_URL, ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL, ... } }`，抄 cc-switch `claudeProviderPresets.ts`。
- `llm-provider-form.tsx` 顶部加**预设选择器**（网格按钮，分类排序：官方 → 国内官方 → 聚合站 → ＋自定义）。点预设 → `setState` 一键填 name / base_url / auth_field / default_fallback_model / 角色映射 / website_url（api_key 留空给用户填）。

### Wave B · 用量查询（后端代查 + 前端展示）

- **后端** `POST /api/llm-providers/{id}/usage`（owner 级）：
  - `service.query_usage(provider_id)`：解密 api_key + 取 base_url → `detect_provider(base_url)` 识别是哪家 → 路由到 `balance` 或 `token_plan` handler → 统一返回 `UsageResult`。
  - 不依赖预设标记，**后端按 base_url 子串 `detect_provider`**（抄 cc-switch `balance.rs:26` / `coding_plan.rs:25`）。预设的 `usage?` 字段仅前端展示用。
  - **balance 路径**（账户余额，GET + Bearer，15s 超时）：DeepSeek `/user/balance`、硅基流动 `/v1/user/info`、OpenRouter `/api/v1/credits`。
  - **token_plan 路径**（编程套餐额度，GET + Bearer）：Kimi / Kimi For Coding `/coding/v1/usages`、智谱 GLM `/api/paas/v4/coding-plan/quota`、MiniMax `/v1/api/openplatform/coding_plan/remains`。
  - **错误两态**（抄 cc-switch，D-005）：瞬时（网络/5xx/429/读体中断）→ `raise AppError`（前端保留上次成功值 10 分钟）；确定性（401/403/4xx/空 key/未知供应商）→ `return UsageResult{success:false}`（前端翻红）。
  - **SSRF**：复用 `tool_policy.ToolPolicyService.assert_public_hostname`（fetch-models task-03 已加，IPv4+IPv6+getaddrinfo 包 asyncio.to_thread）。
  - 精确端点/响应字段 parser 在 execute 阶段逐一对照 cc-switch `balance.rs` / `coding_plan.rs` 抄。
- **前端** `llm-provider-list.tsx`：每行加「查余额」按钮 + inline 余额条（多 tier，逐条 `UsageData` 渲染：plan_name / used / remaining / unit + 进度条 + 重置时间）；进列表页对支持用量的供应商**自动查一次**；失败保留上次成功值 10 分钟，鉴权失败翻红。不支持用量（百炼/官方/detect 不到）显示「该供应商暂不支持余额查询」，不报错。
- `lib/api/llm-providers.ts` 加 `queryUsage(id)` + `UsageResult/UsageData` 类型。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/config/llmProviderPresets.ts` | 10 家预设常量 + `LlmProviderPreset` 类型（Wave A） |
| 修改 | `frontend/src/components/llm-providers/llm-provider-form.tsx` | 顶部预设选择器网格 + 点预设 setState 填表单（Wave A） |
| 修改 | `frontend/src/components/llm-providers/llm-provider-list.tsx` | 每行余额条 + 查余额按钮 + 进页面自动查一次 + 保留上次成功值（Wave B） |
| 新增 | `frontend/src/components/llm-providers/usage-footer.tsx` | 余额条组件（多 tier 渲染 + 翻红 + 状态文案），照 cc-switch `UsageFooter.tsx`（Wave B） |
| 修改 | `frontend/src/lib/api/llm-providers.ts` | `queryUsage(id)` + `UsageResult/UsageData` 类型（Wave B） |
| 修改 | `backend/app/modules/llm_provider/router.py` | `POST /{id}/usage` 端点（Wave B） |
| 修改 | `backend/app/modules/llm_provider/schema.py` | `UsageResult/UsageData/UsageQueryError` schema（Wave B） |
| 修改 | `backend/app/modules/llm_provider/service.py` | `query_usage` + `detect_provider` + 错误类（Wave B） |
| 新增 | `backend/app/modules/llm_provider/usage_handlers.py` | balance / token_plan 各家硬编码 query + parser（抄 cc-switch）（Wave B） |
| 新增 | `backend/app/modules/llm_provider/tests/test_usage.py` | 用量查询测试（mock httpx：每家正常/401/404/超时/SSRF/detect）（Wave B） |
| 新增 | `frontend/src/components/llm-providers/__tests__/usage-footer.test.tsx` | 余额展示测试（成功/翻红/保留上次值/多 tier/不支持）（Wave B） |
| 修改 | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx` | 追加预设选择器测试（点 Kimi For Coding 填表单 / ＋自定义重置 / 💰 标记 6 家 / 编辑模式隐藏） |
| 新增 | `frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx` | 列表挂 UsageFooter 自动查 + 💰 徽标仅可查行 + 暂不支持文案测试 |

> 预设是否单列测试文件（`config/__tests__/llm-provider-presets.test.ts`）在 plan 阶段定（数据校验，可选）。

## 7. 接口定义

### 7.1 用量查询端点

```
POST /api/llm-providers/{provider_id}/usage
  → 200 UsageResult          # 确定性结果（含 success:false）
  → 5xx AppError（瞬时）       # 前端保留上次成功值
```

owner 级（`get_current_user`，跨用户 → 404/403 不泄漏存在性，同既有端点）。

### 7.2 数据结构（对齐 cc-switch `provider.rs:283-315`，snake_case）

```python
class UsageData(BaseModel):
    plan_name: str | None        # 套餐名/币种/窗口名（如「5小时窗」「周限额」）
    extra: str | None            # 附加信息（重置时间等）
    is_valid: bool | None        # 凭据是否有效（False → 翻红）
    invalid_message: str | None
    total: float | None          # 总额（-1 = ∞）
    used: float | None
    remaining: float | None
    unit: str | None             # "USD" / "CNY" / "%"

class UsageResult(BaseModel):
    success: bool
    data: list[UsageData] | None  # 多 tier（5h窗/周/月各自一条）
    error: str | None
```

### 7.3 预设类型

```typescript
type UsageTemplate = { type: "balance" | "token_plan" };  // 仅前端展示「💰可查用量」标记
interface LlmProviderPreset {
  key: string; name: string; category: "official" | "cn_official" | "aggregator";
  base_url: string; auth_field: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";
  default_model?: string; website_url: string; api_key_url?: string;
  usage?: UsageTemplate;          // 存在 = 该家支持用量查询（前端标 💰）
  icon?: string; icon_color?: string;
  settings_config_partial?: Record<string, unknown>;  // 预填 settings_config（env 块）
}
```

## 8. 生命周期契约

**本变更不涉及生命周期契约。** 用量查询是无状态查询端点（GET 语义，POST 仅因 owner 鉴权 + 复用路径参数；不创建/转移任何实体状态、无副作用）；预设是前端常量；不改 `DaemonTaskLease` / `AgentRun` / `AgentSession` 的状态字段或流转，不触发新事件，不碰下发链路 / daemon 三循环。故豁免生命周期契约表。

## 9. 数据模型

**无表结构变更。** `llm_providers` 表不动（D-004：不加 `usage_template` 字段，YAGNI）。用量模板路由由后端 `detect_provider(base_url)` 完成，不依赖 DB 字段；预设的 `usage?` 仅前端展示。

migration head：`202607270900`（fetch-models 已加 settings_config；本变更**不新增 migration**，execute 前用 `alembic heads` 复核单头）。

## 10. 兼容策略（brownfield）

- **未选预设**：表单行为完全不变（用户手填），预设选择器是新增可选入口；既有供应商不受影响。
- **不支持用量的供应商**（百炼/Anthropic 官方/detect 不到）：显示「该供应商暂不支持余额查询」（D-010：文案不带 cc-switch 字样），不报错，不影响 CRUD / 启动停止 / 下发。
- **用量查询失败**：前端保留上次成功值 10 分钟（网络抖动）；鉴权失败翻红但仍显示上次值（D-005）。
- **新增端点** `POST /{id}/usage` 不影响现有任何端点（CRUD / set-unset-default / fetch-models）。
- **api_key 明文**：后端解密代查，明文不出后端 / 不入响应 / 不入日志（同 fetch-models NFR-02）。

## 11. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | SSRF（用量查询代查外部 URL） | P1 | 复用 `tool_policy.assert_public_hostname`（fetch-models task-03 已落地，IPv4+IPv6+to_thread） |
| R-02 | api_key 明文暴露 | P1 | 后端解密代查，明文永不入响应/日志（同 fetch-models） |
| R-03 | 各家响应结构异构 | P2 | 硬编码 per-provider parser，execute 对照 cc-switch `balance.rs`/`coding_plan.rs` 逐一抄 |
| R-04 | 中转站不支持余额接口 | P2 | 友好提示「暂不支持」；错误分类（404/405 → 不支持，区别于 401/403 鉴权失败） |
| R-05 | 预设 base_url / 默认模型过期 | P2 | 预设是常量可改；用户保存后可编辑覆盖，预设仅影响新建预填 |
| R-06 | 多 tier 展示复杂 | P2 | `UsageResult.data` 数组逐 tier 渲染，照 cc-switch `UsageFooter` block 模式 |
| R-07 | detect_provider 识别不准 | P2 | 按 base_url 子串匹配多家候选；识别不到 → 归类「不支持」，不报错 |

## 12. 决策追踪

| ID | 决策 | 覆盖章节 |
|---|---|---|
| D-001 | 预设放前端常量，后端/DB 不存预设数据 | §5 Wave A / §9 |
| D-002 | 用量查询走后端代查（Web 部署唯一可行；不碰 daemon/下发链路） | §5 Wave B |
| D-003 | 用量按 templateType 硬编码（方案 A，抄 cc-switch；非配置驱动引擎） | §5 / §7 |
| D-004 | 后端按 `detect_provider(base_url)` 路由，预设 `usage?` 仅前端展示；不加 DB 字段（YAGNI） | §5 / §7.3 / §9 |
| D-005 | 错误两态：瞬时 raise + 前端保留上次成功值 10 分钟；确定性 success:false 翻红 | §5 / §10 |
| D-006 | 触发 = 手动「查余额」+ 进页面自动查一次；不做后台定时 | §5 Wave B |
| D-007 | 套餐额度多窗口 tier 展示（5 小时窗/周/月各自一条，对齐 cc-switch） | §7.2 / §10 |
| D-008 | 官方订阅 / Copilot / 自定义脚本 / 百炼用量 = 非目标 | §3 |
| D-009 | SSRF 复用 `tool_policy.assert_public_hostname`（同 fetch-models） | §5 / §11 R-01 |
| D-010 | 不支持用量的提示文案不带 cc-switch 字样 | §10 |

## 13. 自审

**已核实的断言**：
- cc-switch `balance.rs`（DeepSeek/SiliconFlow/OpenRouter）、`coding_plan.rs`（Kimi/Zhipu/MiniMax）端点与解析存在（已 grep 确认）。
- cc-switch `claudeProviderPresets.ts` 含本变更 10 家中 9 家的 settingsConfig（Anthropic 官方/Kimi/Kimi For Coding/智谱/DeepSeek/硅基/OpenRouter/MiniMax/百炼/Bailian For Coding 均在文件内，可直接抄）。
- `tool_policy.assert_public_hostname` 已存在（fetch-models task-03 落地）。
- `LlmProvider` 表字段（model.py）/ `CredentialCipher.decrypt` 范式（service.py `_resolve_fetch_credentials` 已示范解密 + base_url + auth_field 取用）。
- migration head `202607270900`（fetch-models；本变更不加 migration）。

**章节齐全**：背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记/兼容策略/数据模型/生命周期契约/决策追踪/自审 — 全部具备。

**⚠️ 自审存疑（留 plan/execute 核实）**：
- 各家余额接口的**精确响应字段 parser**（如 DeepSeek `balance_infos[].total_balance` vs `available_balance`、智谱按 `unit` 字段分 5h/周窗的具体取值）需 execute 阶段对照 cc-switch 源码逐家抄准，design 仅标方向。
- 前端余额条是否抽成独立 `usage-footer.tsx` 组件还是内联进 list（D-影响文件清单）—— plan 阶段定，倾向独立组件（复用 + 可测）。
- 预设默认模型 / base_url 以 cc-switch 当前值为准，execute 时若 cc-switch 已更新取最新。
