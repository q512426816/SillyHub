---
author: qinyi
created_at: 2026-07-27 09:21:53
---

# 提案书（Proposal）— LLM 供应商：获取模型列表 + 一键设置 + 配置 JSON 编辑器

## 背景

LLM 供应商编辑页（`frontend/src/components/llm-providers/llm-provider-form.tsx`）当前模型角色映射是**纯手填文本框**，用户用中转站时得手动查/记模型名，易填错；且缺少 cc-switch 那种"配置 JSON"高级编辑能力（5 开关 + JSON 编辑器 + 应用通用配置）。

## 方案（参考 cc-switch）

**功能① 获取模型列表 + 一键设置**
- 后端 `POST /api/llm-providers/fetch-models`（双形态：provider_id 后端解密 / base_url+api_key 新建态用完即弃），httpx 异步 + SSRF 防护 + 候选 URL 兜底（剥离 /anthropic 试 /v1/models）+ 错误分类。
- 前端新建 `ModelInputWithFetch`（shadcn，下拉按 owned_by 分组选）；角色映射区**全局获取按钮**（拉一次 4 角色共享）+ **一键设置**（当前模型应用全部 4 角色）。

**功能② 配置 JSON 编辑器（改 daemon 完整闭环）**
- 后端新增 `settings_config` JSON 字段（存高级配置片段）+ migration。
- 前端「配置 JSON」折叠区：5 开关（隐藏署名/Teammates/Tool Search/最大强度思考/禁用自动升级）+ JsonEditor（行号/折叠/格式化）+ 应用通用配置预设。
- **下发闭环**：backend `context.py` 透传 settings_config → daemon `credential-injector.toEnv` 合并 settings_config.env（覆盖 extra_env）+ settings.json 生成处合并顶层（attribution/enabledPlugins/model/skipDangerousModePermissionPrompt）。编辑后真正生效。

## 影响

- **backend**：llm_provider（model/schema/router/service 加 settings_config + fetch-models 端点）+ daemon/lease/context.py（透传）+ migration `202607270900`。
- **daemon**：credential-injector.ts（toEnv 合并 env）+ settings.json 生成处（顶层合并）；需 `pnpm bundle` + backend rebuild。
- **frontend**：llm-provider-form.tsx（角色映射增强 + 配置JSON面板）+ 新建 ModelInputWithFetch + 可能新建 JsonEditor + lib/api/llm-providers.ts。
- 不破坏现有结构化字段（base_url/api_key/角色映射/extra_env 全保留）。

## 决策摘要（D-001~D-009，详见 design.md）

D-001 双形态端点 / D-002 一键应用全部角色 / D-003 全局获取按钮 / D-004 新增 settings_config 字段 / D-005 配置JSON全套对齐 cc-switch / D-006 fetch-models 方案A(httpx+SSRF+候选URL) / D-007 settings_config.env 最后覆盖 / D-008 5 开关映射 / **D-009 改 daemon 完整闭环**。

## 不在范围内（Non-Goals）

- codex/gemini/pi 等 agent_kind 的供应商支持（本期仅 claude）。
- daemon 完整重写 settings.json 生成逻辑（仅合并 settings_config 顶层键，不重构现有生成）。
- cc-switch 式「通用配置」全局管理（多供应商共享预设的 CRUD）——本期「应用通用配置」是固定预设片段，不做跨供应商预设管理 UI。
- 模型列表持久化缓存（每次实时调上游，不缓存）。
- settings_config 的 JSON Schema 严格校验（本期仅 JSON 格式校验 + 5 开关快捷编辑，不做完整 schema 约束）。

## 风险

- SSRF（用户可控 base_url）→ 复用 tool_policy._check_not_private_ip + IPv6 + getaddrinfo 包 to_thread。
- api_key 暴露 → 加密存 + 编辑态后端解密 + 新建态用完即弃，前端永不收明文。
- daemon 改动 → credential-injector.toEnv + settings.json 生成处；plan 阶段定位具体生成函数。
- settings_config vs 结构化字段冲突 → D-007 明确 toEnv 最后覆盖；UI 提示。
