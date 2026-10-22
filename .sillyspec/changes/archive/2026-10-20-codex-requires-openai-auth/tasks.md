---
author: flow-machine-draft
created_at: 2026-10-20T03:44:58.848Z
---
# 任务注册表（Tasks）— 2026-10-20-codex-requires-openai-auth

- [x] task-01: codex-settings.ts 单点修改：CodexFormValues 增 requireOpenAiAuth（anthropic=key 非空 / openai_chat 恒 false），mergeConfigToml 在 wire_api 行后按 bool 追加 `requires_openai_auth = true`——验证：pnpm test codex-settings 相关用例绿
- [x] task-02: 测试同步：golden 用例更新含新行；新增 3 用例（有 key 写出 / keyless 逐字不变 / openai_chat 零回归）——验证：sillyhub-daemon 测试全绿
- [x] task-03: pnpm bundle 产出新 bundle（BUILD_ID 自动更新）并在本机以新 bundle 行为验证 config.toml 产物含新行
- [x] task-04: 部署腾讯云生产（main 打包 build-and-save + scp + load-and-up，health/alembic 验过）并核对 latest.json 新版本
- [x] task-05: 端到端验收：本机 daemon 自更新到新 BUILD_ID 后，平台 codex 会话选「智谱 GLM Codex (wp)」真实对话跑通；清理旧 GLM/OpenCode 供应商 agent_kinds 中的 codex 勾选（消除坏路径）
