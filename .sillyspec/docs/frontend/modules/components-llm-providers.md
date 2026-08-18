---
schema_version: 1
doc_type: module-card
module_id: components-llm-providers
author: qinyi
created_at: 2026-08-18 01:45:00
---

# LLM 供应商管理组件（components-llm-providers）

## 定位
LLM 供应商管理 UI（`components/llm-providers/`，4 组件）：「我的供应商」区块（列表 +
新建/编辑/启停/删除）+ 供应商表单 + 带拉取的模型输入框 + 用量页脚。配置跟随账号、
所有工作空间通用（D-002）；嵌入设置页 /settings/providers，不单独开路由
（task allowed_paths 限定）。派生自 llm-provider-openai-format 系列变更，交互范式
对齐 cc-switch。数据/类型全部来自 lib/api/llm-providers（lib-llm-providers 模块）+
config/llmProviderPresets 预设，组件不自写请求。

## 契约摘要
- `LlmProviderSection`（`llm-provider-list.tsx`）：区块入口组件（line 70 导出）。
  - 状态机：`list ↔ form`（FormMode = create/edit/null；form 打开时只渲染表单，
    取消回列表）。
  - 启动 = `setDefaultProvider`（is_default=true，同 agent 种类互斥仅一个生效）；
    停止 = `unsetDefaultProvider`（全停则 lease 不注入 provider_config，daemon 回归
    本机配置 D-007）。
  - 删除（deleteProvider）/ 新建 / 编辑 / 启停后即时 reload 列表；每行底部挂
    UsageFooter；行摘要 `modelSummary`（默认模型 + 角色映射，ROLE_ORDER 固定序）。
- `LlmProviderForm`（`llm-provider-form.tsx`）：新建/编辑表单。
  - 基本字段：名称 / agent 种类（claude 可用；codex/gemini/pi disabled 占位 D-006）/
    备注 / 官网链接 / base_url / api_key 密码框（编辑留空 = 保持原密钥，全程不明文回显）。
  - 协议格式 `api_format`：`anthropic | openai_chat`（OpenAI 兼容中转，D-001@v1）。
  - 高级项 `<details>` 折叠：认证字段下拉（ANTHROPIC_AUTH_TOKEN 默认 / 
    ANTHROPIC_API_KEY）、4 行角色映射（sonnet/opus/fable/haiku × display/model/one_m）、
    默认兜底模型、自定义 env 键值编辑器（增删行 → extra_env Record）。
  - 模型拉取：fetchProviderModels → ModelInputWithFetch 展示。
- `ModelInputWithFetch`（`model-input-with-fetch.tsx`）：模型输入框。
  - 三态分支（优先级序）：① fetchedModels 非空 → Input + DropdownMenu（按 owned_by
    分组，null 归「其他」组）；② isLoading → spinner；③ 有 onFetch →「获取」按钮；
    ④ 否则纯 Input 手填。
  - `FetchedModel { id, owned_by }` 字段名对齐后端下划线（不照抄 cc-switch 驼峰）。
  - 纯展示 + 回调，不自己发请求。
- `UsageFooter`（`usage-footer.tsx`）：行底用量条。
  - 客户端 `detectUsageProvider(baseUrl)` 预判可查性：null → 静态「暂不支持」不发请求
    （省一次往返）；可查才 queryUsage + 手动刷新。
  - keep-last-good：上游瞬时失败（网络/5xx/429/超时）保留上次成功值 10 分钟
    （`KEEP_LAST_GOOD_MS`，移植 cc-switch resolveDisplayUsage）。
  - 两态错误模型：200 success=false + is_valid=false → **翻红**（鉴权失效）；
    其它 success=false / 5xx → 灰提示 / 瞬时分支。
- 测试：`__tests__/` 6 套（form×3 / list / model-input-with-fetch / usage-footer /
  presets）。

## 关键逻辑
- 用量页脚状态机（UsageView 五态）：
  ```
  detect = detectUsageProvider(baseUrl)        // null → 不发请求
  queryUsage(providerId) → ok(tiers) | invalid(翻红) | unsupported | error
  瞬时失败 → 上次成功值 < 10min ? 保留(标 stale) : 报错
  ```

## 注意事项
- api_key 全程不明文回显是安全约定（编辑态密码框留空占位"保持原密钥不变"），
  勿为"方便"加回显。
- 角色映射 4 键（sonnet/opus/fable/haiku）是前后端契约：表单 ROLE_ROWS 与列表
  ROLE_ORDER/modelSummary 均按此序，改须同步后端 DTO + pnpm gen:types。
- 启停语义与 daemon 注入链路强耦合：全停 → lease 不注入 provider_config → daemon
  回归本机；勿改成多选启用（R-05 同种类仅一个生效）。
- openai_chat 格式是 OpenAI 兼容中转接入点，表单已预留——改 api_format 相关字段须
  同步后端 schema 并跑 gen:types，不让 api-types.ts 落后。
- 预设（PRESETS_BY_CATEGORY）只做表单辅助填充，非必选路径（D-003 纯自定义）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
