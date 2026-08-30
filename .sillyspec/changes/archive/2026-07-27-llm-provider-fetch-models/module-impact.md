---
author: qinyi
created_at: 2026-08-30 20:10:00
change: 2026-07-27-llm-provider-fetch-models
---

# 模块影响分析（Module Impact）— LLM 供应商获取模型列表 + 一键设置 + 配置 JSON 编辑器

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:llm_provider | 接口变更+数据结构变更 | settings_config 字段（migration 202607270900 单头）；POST /fetch-models 双形态端点（候选URL/AUTH/UNSUPPORTED/ALL_FAILED/TIMEOUT 四类错误）；context.py 透传 settings_config |
| backend:core | 调用关系变更 | SSRF 校验复用 tool_policy assert_public_hostname + IPv6 私网段扩展（::1/fc00::7/fe80::10）+ getaddrinfo to_thread |
| sillyhub-daemon:credential-injector | 逻辑变更 | toEnv 合并 settings_config.env（extra_env 之后 Object.assign） |
| sillyhub-daemon:claude-settings | 新增 | applyClaudeSettings（白名单 4 顶层键）生成 settings.json；task-runner.ts/daemon.ts 挂钩；pnpm bundle 重建 |
| frontend:components-llm-providers | 新增 | ModelInputWithFetch 组件（4 态）、llm-provider-form 全局获取/一键设置/4 角色下拉、json-editor（自研 5 开关+预设） |
| frontend:lib-llm-providers | 接口变更 | fetchProviderModels 双形态 + FormValues.settings_config 可选 + formToCreate/formToUpdate |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/migrations/versions/202607270900*.py | 新增迁移文件（单头实测可逆） |
| backend/openapi.json、frontend/src/lib/api-types.ts、build/bundle/sillyhub-daemon.js | 生成物/构建产物，不手改 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `backend modules/llm_provider.md` | 已含 fetch-models/settings_config 语义（scan 收录，归档期 grep 核实 2 命中） | skipped（已同步） |
| `backend _module-map.yaml` llm_provider | entrypoints 注释含 fetch-models、FetchModelsRequest 已列 | skipped（已同步） |
| `sillyhub-daemon modules/claude-settings.md`/`credential-injector.md`/`types.md` | settings_config/applyClaudeSettings 语义已收录（grep 核实） | skipped（已同步） |
| `frontend modules/components-llm-providers.md`/`lib-llm-providers.md` | fetchProviderModels/ModelInputWithFetch/json-editor 已收录（grep 核实） | skipped（已同步） |
