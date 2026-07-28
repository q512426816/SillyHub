---
author: qinyi
created_at: 2026-07-28 10:26:00
plan_level: full
---

# 实现计划（Plan）— LLM 供应商：预设模版 + 用量查询

> 来源：design.md（scale=large, revision 1, D-001~D-010 全 confirmed）+ requirements.md（FR-01~FR-08, NFR-01~05）+ tasks.md（粗粒度草案）。
> 本计划细化 Wave/Task/依赖/落地行号。**比 fetch-models 变更简单：不涉及 daemon、不加 migration、无下发链路改动**。Design Grill verdict=pass（1 个 P2 智谱团队版 → 本计划标非目标）。

## Spike 前置验证

**无 Spike。** 技术方案确定性强：用量查询各家端点/parser 直接对照 cc-switch `balance.rs`/`coding_plan.rs` 抄（cc-switch 已实现并验证）；SSRF 复用已落地的 `tool_policy.assert_public_hostname`；预设抄 cc-switch `claudeProviderPresets.ts`。无未经验证的新技术栈/隔离/性能不确定性。

## 关键路径与并行策略

```
Wave 1（后端用量）─ task-01 schema ─ task-02 handlers ─ task-03 service+detect+SSRF ─ task-04 router
                                                                    │
Wave 2（前端）─── task-05 预设常量（独立）── task-07 form 选择器      │
                 task-06 api+类型 ── task-08 usage-footer ─ task-09 list 挂载
                                                                    │
Wave 3（测试）── task-10 后端测试（依赖 Wave1）─────────────────────┤
                 task-11 前端测试（依赖 Wave2）──────────────────────┘
```

- **并行子代理**：Wave 1（后端链）与 Wave 2 的 task-05（预设，纯前端无后端依赖）/ task-06（api 类型，依赖 design 契约不依赖后端代码）跨语言无冲突，可并行（≤4 并发，规避 529）。
- **task-05 完全独立**（预设常量，不依赖任何后端），可最早开工。
- **跨平台**：所有命令用 `local.yaml` 的 `cd <sub> && <cmd>` 链。

## Wave 1 — 后端用量查询核心（无前端依赖）

- [ ] task-01: `backend/app/modules/llm_provider/schema.py` 加 `UsageData`（plan_name/extra/is_valid/invalid_message/total/used/remaining/unit，全 Optional）+ `UsageResult`（success/data:list[UsageData]|None/error:str|None）+ 用量错误类（瞬时类，对应 5xx）。照 cc-switch `provider.rs:283-315` snake_case。（覆盖：FR-03, FR-04, D-005）
- [ ] task-02: 新建 `backend/app/modules/llm_provider/usage_handlers.py`：balance 路径（DeepSeek `/user/balance`、硅基 `/v1/user/info`、OpenRouter `/api/v1/credits`）+ token_plan 路径（Kimi/Kimi For Coding `/coding/v1/usages`、智谱 `/api/paas/v4/coding-plan/quota`、MiniMax `/v1/api/openplatform/coding_plan/remains`）各家硬编码 query + parser，对照 cc-switch `balance.rs`/`coding_plan.rs` 逐家抄准精确字段。返回 `list[UsageData]`（多 tier）。— 依赖 task-01
- [ ] task-03: `backend/app/modules/llm_provider/service.py` 加 `query_usage(provider_id, user_id)`：解密 api_key（复用 `_resolve_fetch_credentials` 范式取 base_url+key+auth_field）+ `detect_provider(base_url)`（按 base_url 子串路由 balance/token_plan，照 cc-switch `balance.rs:26`/`coding_plan.rs:25`）+ 调 task-02 handler + **错误两态**（瞬时网络/5xx/429/超时 → raise AppError 5xx；确定性 401/403/空 key/未知供应商 → `UsageResult{success:false}`）+ SSRF 复用 `tool_policy.ToolPolicyService.assert_public_hostname`。15s 超时。（覆盖：FR-03, FR-04, FR-08, D-004, D-005, D-009）— 依赖 task-02
- [ ] task-04: `backend/app/modules/llm_provider/router.py` 加 `POST /{provider_id}/usage`（owner 级 `get_current_user`，跨用户 404/403 不泄漏）。在 fetch-models 端点后追加。（覆盖：FR-03）— 依赖 task-03

## Wave 2 — 前端（预设独立 + 用量依赖契约）

- [ ] task-05: 新建 `frontend/src/config/llmProviderPresets.ts`：导出 10 家 claude 风格预设常量（Anthropic官方/Kimi/Kimi For Coding/智谱GLM/DeepSeek/硅基流动/OpenRouter/MiniMax/百炼/Bailian For Coding）+ `LlmProviderPreset` 类型（key/name/category/base_url/auth_field/default_model/website_url/api_key_url?/usage?:{type}?/icon?/icon_color?/settings_config_partial?）。settings_config env 块抄 cc-switch `claudeProviderPresets.ts`。支持用量的 7 家带 `usage:{type:balance|token_plan}`。（覆盖：FR-01, FR-02, D-001）
- [ ] task-06: `frontend/src/lib/api/llm-providers.ts` 加 `queryUsage(id)` → `POST /api/llm-providers/{id}/usage` + `UsageResult`/`UsageData` 类型（对齐后端 schema）。（覆盖：FR-03 前端）— 依赖 design §7 契约，可与 Wave1 并行
- [ ] task-07: `frontend/src/components/llm-providers/llm-provider-form.tsx` 顶部（mode 判断后、表单 grid 前）加**预设选择器**（网格按钮 + 分类排序 官方/国内官方/聚合站 + ＋自定义 + 💰可查用量标记）；点预设 `setState` 填 name/base_url/auth_field/default_fallback_model/角色映射/website_url（api_key 留空）；点自定义重置空表单。（覆盖：FR-01, FR-02, D-001）— 依赖 task-05
- [ ] task-08: 新建 `frontend/src/components/llm-providers/usage-footer.tsx`：多 tier 余额条（逐 `UsageData` 渲染 plan_name/used/remaining/unit + 进度条 + 重置时间）+ `is_valid=false` 翻红 + **保留上次成功值 10 分钟**（照 cc-switch `queries.ts:192 resolveDisplayUsage` 纯函数移植）+ 不支持文案「该供应商暂不支持余额查询」（不带 cc-switch 字样）。（覆盖：FR-05, FR-07, D-005, D-007, D-010）— 依赖 task-06
- [ ] task-09: `frontend/src/components/llm-providers/llm-provider-list.tsx` 每行挂 `<UsageFooter>` + 「查余额」按钮；`useEffect` 进页面自动对支持用量的供应商查一次；手动按钮触发单家刷新。（覆盖：FR-06, D-006）— 依赖 task-08, task-06

## Wave 3 — 测试（依赖对应 Wave 实现）

- [ ] task-10: 后端测试 `backend/app/modules/llm_provider/tests/test_usage.py`：mock httpx 覆盖每家（DeepSeek/硅基/OpenRouter balance 正常 + Kimi/Kimi For Coding/智谱/MiniMax token_plan 多 tier 正常）+ 错误分类（401→success:false is_valid:false / 404→不支持 / 超时→raise 5xx / SSRF 拒私网+IPv6）+ detect_provider 路由（Kimi vs Kimi For Coding 同 api.kimi.com / 智谱个人版）+ api_key 明文不入响应/日志断言。（覆盖：AC-02, AC-03, AC-04, AC-07, NFR-01/02/03）— 依赖 task-01~04
- [ ] task-11: 前端测试：预设选择器（点 Kimi For Coding 填表单 / 点自定义重置 / 💰标记）+ usage-footer（成功多 tier / 翻红 / 保留上次值 / 不支持文案）+ list 自动查一次。（覆盖：AC-01, AC-05, AC-06）— 依赖 task-05/07/08/09

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | UsageResult/UsageData/错误类 schema | 1 | P0 | — | FR-03/04, D-005 | snake_case 对齐 cc-switch |
| task-02 | usage_handlers.py balance+token_plan 硬编码 | 1 | P0 | task-01 | FR-03, D-003 | 抄 cc-switch balance.rs/coding_plan.rs |
| task-03 | service query_usage+detect+错误两态+SSRF | 1 | P0 | task-02 | FR-03/04/08, D-004/005/009 | 复用 _resolve_fetch_credentials + assert_public_hostname |
| task-04 | router POST /{id}/usage | 1 | P0 | task-03 | FR-03 | owner 级，fetch-models 端点后追加 |
| task-05 | config/llmProviderPresets.ts 10家预设 | 2 | P0 | — | FR-01/02, D-001 | 纯前端常量，独立可最早开工 |
| task-06 | lib/api queryUsage + 类型 | 2 | P0 | design §7 | FR-03前端 | 可与 Wave1 并行 |
| task-07 | form 顶部预设选择器 | 2 | P0 | task-05 | FR-01/02, D-001 | 网格+分类+一键填表单 |
| task-08 | usage-footer.tsx 多tier余额条 | 2 | P0 | task-06 | FR-05/07, D-005/007/010 | 移植 resolveDisplayUsage 保留上次值 |
| task-09 | list 挂 footer + 查余额 + 自动查 | 2 | P0 | task-08, task-06 | FR-06, D-006 | 进页面自动查一次 |
| task-10 | 后端 test_usage.py | 3 | P0 | task-01~04 | AC-02/03/04/07 | mock httpx + detect + SSRF |
| task-11 | 前端测试 | 3 | P0 | task-05/07/08/09 | AC-01/05/06 | 预设选择器 + usage-footer |

## 关键路径

task-01 → task-02 → task-03 → task-04（后端链，4 步）‖ task-06 → task-08 → task-09（用量前端链，3 步，与后端并行）→ task-10/11 测试收尾。task-05/07（预设）独立支线，不阻塞主路径。最短交付 ≈ 后端链 + 测试。

## 全局验收标准（对照 requirements FR + AC）

| AC | 覆盖任务 | 验收证据 |
|---|---|---|
| AC-01 选预设一键填表单（只剩 API Key 手填） | task-05, task-07, task-11 | 点 Kimi For Coding → 表单填好 base_url/auth/默认模型/官网 |
| AC-02 balance 路径返回正确余额（DeepSeek/硅基/OpenRouter） | task-02, task-03, task-10 | mock httpx 返回 remaining/total/unit 正确 |
| AC-03 token_plan 路径返回多 tier（Kimi/智谱/MiniMax） | task-02, task-03, task-10 | 多 tier（5h窗/周窗）逐条解析 |
| AC-04 错误两态：瞬时保留上次值/鉴权翻红 | task-03, task-08, task-10, task-11 | 网络抖动 10min 内显示旧值；401 翻红 |
| AC-05 不支持用量显示「该供应商暂不支持余额查询」 | task-08, task-09, task-11 | 百炼/Anthropic 官方/detect 不到 → 灰色提示不报错 |
| AC-06 进页面自动查一次 + 手动查余额按钮 | task-09, task-11 | useEffect 触发支持供应商查询 + 按钮刷新 |
| AC-07 SSRF 拒私网/IPv6 + api_key 不入响应日志 | task-03, task-10 | assert_public_hostname 拒绝 + UsageResult 无 key 字段 |
| AC-08 三端测试全绿（brownfield 零回归） | task-10, task-11 | backend pytest llm_provider + frontend vitest 全过；既有 CRUD/fetch-models 不受影响 |

## 覆盖矩阵（决策 → 任务 → AC）

| 决策 | 覆盖任务 | 验收 AC |
|---|---|---|
| D-001 预设前端常量 | task-05, task-07 | AC-01 |
| D-002 用量后端代查 | task-03, task-04 | AC-02, AC-03 |
| D-003 用量按 templateType 硬编码 | task-02 | AC-02, AC-03 |
| D-004 detect_provider(base_url) 路由不加字段 | task-03 | AC-02, AC-03, AC-07 |
| D-005 错误两态 | task-03, task-08 | AC-04 |
| D-006 手动+进页面自动查 | task-09 | AC-06 |
| D-007 多窗口 tier 展示 | task-02, task-08 | AC-03 |
| D-008 官方订阅/Copilot/脚本/百炼非目标 | task-02（不实现这些 handler） | AC-05 |
| D-009 SSRF 复用 tool_policy | task-03 | AC-07 |
| D-010 不支持文案不带 cc-switch | task-08 | AC-05 |

## 风险与边界

1. **detect_provider 识别冲突**（Grill B-01 相关）：Kimi vs Kimi For Coding 同 `api.kimi.com`（For Coding 走 `/coding/` 子路径，detect 命中 `/coding` 同分支正确）；**智谱团队版同 `open.bigmodel.cn` 需额外 org/project 参数 → 第一版非目标**（仅做个人版，detect `bigmodel.cn` → 智谱个人版）。task-03 detect 逻辑须覆盖 Kimi For Coding 的 `/coding` 区分。
2. **各家 parser 精确字段**（design 自审存疑）：task-02 execute 时对照 cc-switch `balance.rs`/`coding_plan.rs` 逐家抄准（如 DeepSeek `balance_infos[].total_balance`、智谱按 `unit` 分 5h/周窗），不靠猜。
3. **错误两态 raise 被吞**：task-03 瞬时错误 raise AppError（5xx），须确认全局异常处理器转成 5xx 而非 500（service.py 既有 AppError 范式已保证，task-10 测试断言 HTTP 状态码）。
4. **SSRF**（D-009）：复用 `assert_public_hostname`（IPv4+IPv6+to_thread），各家公网域名可过；task-10 测私网/IPv6 拒绝。
5. **api_key 暴露**：后端解密代查，明文仅局部变量；UsageResult schema 不含 key；task-10 断言响应/日志无明文。
6. **保留上次成功值时序**（task-08）：`resolveDisplayUsage` 是纯函数（cc-switch `queries.ts:192`），移植时注意 React state 持有 lastGood（useRef）+ 10min 窗口判定。
7. **预设 base_url/模型过期**：预设常量可改；用户保存后可编辑覆盖；预设仅影响新建预填。
8. **migration**：本变更**不加 migration**（不加字段）。execute 前 task-01 复核 `alembic heads` 单头（应为 `202607270900`）。

## 文件变更清单（落地行号）

**backend**
- `backend/app/modules/llm_provider/schema.py`（task-01，FetchModelsResponse 后加 UsageResult/UsageData/错误类）
- `backend/app/modules/llm_provider/usage_handlers.py`（task-02，**新建**）
- `backend/app/modules/llm_provider/service.py`（task-03，fetch_models 后加 query_usage + detect_provider；现有 LlmProvider* 错误类后加用量错误类）
- `backend/app/modules/llm_provider/router.py`（task-04，fetch-models 端点后加 POST /{id}/usage）
- `backend/app/modules/llm_provider/tests/test_usage.py`（task-10，**新建**）

**frontend**
- `frontend/src/config/llmProviderPresets.ts`（task-05，**新建**）
- `frontend/src/lib/api/llm-providers.ts`（task-06，fetchProviderModels 后加 queryUsage + 类型）
- `frontend/src/components/llm-providers/llm-provider-form.tsx`（task-07，顶部加预设选择器）
- `frontend/src/components/llm-providers/usage-footer.tsx`（task-08，**新建**）
- `frontend/src/components/llm-providers/llm-provider-list.tsx`（task-09，每行挂 footer + 按钮 + useEffect 自动查）
- `frontend/src/components/llm-providers/__tests__/usage-footer.test.tsx`（task-11，**新建**；预设选择器测试并入 form 测试或单列，execute 定）

> 不改入口文件（main.py / cli.ts / next 入口）。router.py 加端点是模块内路由注册，非入口。design 未提入口文件，无 path-check 阻断。**不改 daemon、不加 migration、不改下发链路。**

## 测试策略（对齐 local.yaml `test_strategy: module`）

| 模块 | 命令 | 命中 task |
|---|---|---|
| llm_provider | `cd backend && uv run pytest app/modules/llm_provider -q --no-cov` | task-01/02/03/04/10 |
| frontend | `cd frontend && pnpm test` | task-05/06/07/08/09/11 |

lint/typecheck：backend `uv run ruff check . && uv run ruff format --check . && uv run mypy app`；frontend `pnpm lint && pnpm typecheck`。

## 执行建议

- **Wave 1 后端链 + Wave 2 task-05/06 并行**（跨语言无冲突，子代理 ≤4 并发规避 529）。
- **task-05（预设）最早开工**（完全独立，纯前端数据）。
- **task-02 parser 抄 cc-switch** 是质量关键（execute 时打开 `balance.rs`/`coding_plan.rs` 逐家对照）。
- **AC-08 零回归**：既有 CRUD/fetch-models/set-unset-default 不受影响（新端点 + 新组件，不改既有逻辑）。
- 真实余额查询（需有效 key 调真实供应商）放 verify 阶段端到端抽测，不靠单测 mock。
