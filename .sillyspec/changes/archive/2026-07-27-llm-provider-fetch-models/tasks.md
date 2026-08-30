---
author: qinyi
created_at: 2026-07-27 09:21:53
---

# 任务清单（Tasks）— LLM 供应商：获取模型列表 + 一键设置 + 配置 JSON 编辑器

> 依赖：design.md（D-001~D-009）+ requirements.md（FR-01~FR-10）。Wave 分组供 plan 阶段细化为带依赖的任务表。

## Wave 1 — 后端数据模型 + fetch-models 端点（无前端依赖）

- **task-01**：`llm_provider/model.py` 加 `settings_config: dict|None`（JSON 列）+ `schema.py` Create/Update/Read 加字段 + migration `202607270900`（接 head 202607251600，SQLite/PG 方言分支）。（FR-06）
- **task-02**：`llm_provider/router.py` + `service.py` 加 `POST /llm-providers/fetch-models`：双形态 body（provider_id 解密 / base_url+api_key 直传）；httpx.AsyncClient(timeout=10) + 候选 URL 兜底（剥离 /anthropic 试 /v1/models）+ 鉴权头按 auth_field + 错误分类（401/403/404/405/超时/All failed）。（FR-01/02/03）
- **task-03**：fetch-models SSRF 防护：复用 `tool_gateway/tool_policy._check_not_private_ip`（IPv4Network 成员 + is_reserved）+ 补 IPv6（::1/fc00::/7/fe80::/10）+ `socket.getaddrinfo` 包 `asyncio.to_thread`。（NFR-01，对齐 tool_gateway/service.py:152）
- **task-04**：`daemon/lease/context.py:139-148` provider_config dict 加 `"settings_config": provider.settings_config` 透传。（FR-10 前段）

## Wave 2 — daemon 下发闭环（依赖 Wave1 task-01 字段定义）

- **task-05**：`sillyhub-daemon/src/credential-injector.ts`：`ProviderConfig` 类型加 `settings_config?`；`toEnv` 在 `Object.assign(env, c.extra_env)` 之后追加 `Object.assign(env, c.settings_config?.env ?? {})`（D-007 覆盖优先级最高）。（FR-10 中段）
- **task-06**：daemon 生成 Claude settings.json 处（grep `CLAUDE_CONFIG_DIR`/`settings.json` 定位）合并 `settings_config` 顶层（attribution/enabledPlugins/model/skipDangerousModePermissionPrompt）。（FR-10 后段；plan 阶段先 spike 定位具体函数）
- **task-07**：daemon `pnpm bundle` 重建（credential-injector.ts 改了 src/）。

## Wave 3 — 前端（依赖 Wave1 端点 + 字段）

- **task-08**：新建 `frontend/src/components/llm-providers/model-input-with-fetch.tsx`（shadcn DropdownMenu 按 owned_by 分组选；移植 cc-switch ModelInputWithFetch，中文）。（FR-04 组件）
- **task-09**：`llm-provider-form.tsx` 角色映射区改造：顶部加全局「获取模型列表」+「一键设置」按钮；4 角色 model 字段改用 ModelInputWithFetch（共享 fetchedModels 状态）；一键设置取第一非空填全部。（FR-04/05）
- **task-10**：`llm-provider-form.tsx` 加「配置 JSON」折叠区：5 开关 toggle 编辑 settings_config（D-008 映射，照 cc-switch CommonConfigEditor:100-157）+ JsonEditor（轻量自研 textarea+行号+折叠+格式化，或移植 cc-switch JsonEditor，plan 定）+ 应用通用配置预设。（FR-07/08/09）
- **task-11**：`lib/api/llm-providers.ts` 加 `fetchProviderModels(双形态)` + 类型加 `settings_config`；form values + 提交 payload 加 settings_config。（FR-01 前端 + FR-06 前端）

## Wave 4 — 测试（依赖全部实现）

- **task-12**：后端测试（`llm_provider/tests/`）：fetch-models mock httpx（正常/401/404→候选兜底/全失败/超时/SSRF 拒私网+IPv6/双形态）；migration upgrade head 单头；context.py 透传 settings_config。
- **task-13**：daemon 测试（`credential-injector` 单测）：toEnv 合并 settings_config.env（覆盖 extra_env）；settings.json 生成合并顶层。
- **task-14**：前端测试：ModelInputWithFetch（拉取中/下拉选/无 onFetch）；配置JSON面板（5 开关 toggle 改 JSON/格式化/应用预设/JSON 非法不崩）；一键设置。

## 关键路径

task-01（字段+migration）→ task-02/03（fetch-models）+ task-04（透传）→ task-05/06（daemon 闭环，task-06 需 spike 定位）→ task-08~11（前端）→ task-12~14（测试）。

## 验收（对照 requirements AC-01~AC-07）

三端测试全绿 + migration 单头 + AC-01~AC-06 手动/集成验证（含 daemon 真跑 claude 验 settings_config 生效，AC-05）。
