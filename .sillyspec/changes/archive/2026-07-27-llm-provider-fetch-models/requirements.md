---
author: qinyi
created_at: 2026-07-27 09:21:53
---

# 需求（Requirements）— LLM 供应商：获取模型列表 + 一键设置 + 配置 JSON 编辑器

## 功能需求（FR）

**功能① 获取模型列表 + 一键设置**
- **FR-01**：`POST /api/llm-providers/fetch-models` 端点，支持双形态——`{provider_id}`（后端解密 encrypted_api_key 用）或 `{base_url, api_key, auth_field?}`（新建未存，用完即弃不落库）。返回 `{models:[{id, owned_by}]}`。
- **FR-02**：fetch-models 用 OpenAI 兼容 `GET /v1/models`；候选 URL 兜底（base_url 404/405 时剥离 `/anthropic`/`/compatibility`/`/api` 再试）。
- **FR-03**：fetch-models 鉴权头按 auth_field（ANTHROPIC_AUTH_TOKEN→Authorization Bearer / ANTHROPIC_API_KEY→x-api-key）。
- **FR-04**：前端角色映射区**全局「获取模型列表」按钮**（4 角色共用，拉一次）；拉到后 4 角色 model 字段变下拉（按 owned_by 分组选）。
- **FR-05**：**「一键设置」按钮**：取当前任一非空模型，填到 sonnet/opus/fable/haiku 全部 4 角色。

**功能② 配置 JSON 编辑器（改 daemon 闭环）**
- **FR-06**：LlmProvider 新增 `settings_config`（JSON，可空）字段 + migration。
- **FR-07**：前端「配置 JSON」折叠区：5 开关（隐藏AI署名/Teammates/Tool Search/最大强度思考/禁用自动升级）toggle 实时编辑 settings_config。
- **FR-08**：JsonEditor（行号 + 折叠 + 格式化按钮）。
- **FR-09**：「应用通用配置」预设按钮（合并预设 env+enabledPlugins 片段）。
- **FR-10**：下发闭环——backend context.py 把 settings_config 透传进 provider_config；daemon credential-injector.toEnv 合并 settings_config.env（覆盖 extra_env 之后）；daemon settings.json 生成处合并 settings_config 顶层（attribution/enabledPlugins/model/skipDangerousModePermissionPrompt）。

## 非功能（NFR）

- **NFR-01 安全/SSRF**：fetch-models 拒私网/保留地址（复用 tool_policy._check_not_private_ip + 补 IPv6）；getaddrinfo 包 asyncio.to_thread 防阻塞。
- **NFR-02 安全/api_key**：api_key 加密存（CredentialCipher）；编辑态后端解密；新建态用完即弃；前端永不收明文；api_key 永不进 settings_config 明文。
- **NFR-03 性能**：fetch-models 超时 10s；候选 URL 顺序尝试（不并发，防中转站限流）。
- **NFR-04 兼容**：跨 Windows/Linux/macOS；daemon bundle 重建 + backend rebuild 部署。
- **NFR-05 零回归**：现有结构化字段下发链路（base_url/角色映射/extra_env）不变；现有 provider 数据无 settings_config 视为 None。

## 验收标准（AC）

- **AC-01**：新建供应商页填中转站 base_url+key → 点「获取模型列表」→ 下拉显示拉到的模型（按 owned_by 分组）；选一个填到某角色。
- **AC-02**：点「一键设置」→ 当前模型填到 sonnet/opus/fable/haiku 全部 4 角色。
- **AC-03**：编辑已存供应商 → 角色映射「获取」用 provider_id（后端解密 key）成功拉取。
- **AC-04**：配置 JSON 面板 5 开关 toggle → settings_config JSON 对应键正确增删；格式化按钮生效；应用通用配置合并预设。
- **AC-05**：保存带 settings_config 的供应商 → daemon 用该 provider 跑 agent 时，claude 进程 env 含 settings_config.env 的开关（如 ENABLE_TOOL_SEARCH=true）；settings.json 含 attribution/enabledPlugins 顶层。
- **AC-06**：fetch-models 对私网 base_url 返回 SSRF 拒绝错误；对 404 中转站返回"未开放模型列表"提示。
- **AC-07**：三端测试全绿（backend ruff/mypy + pytest；daemon tsc + vitest；frontend tsc + vitest）；migration `alembic upgrade head` 单头 `202607270900`。
