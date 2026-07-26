---
author: qinyi
created_at: 2026-07-25 16:30:03
---

# 任务清单（Tasks）

> 任务细节在 plan 阶段展开。按 design.md §5 的 Wave 组织。

## Wave 1：后端基础（llm_provider 模块）

- task-01: 新建 `llm_providers` 表 + migration（含 created_at/updated_at 显式定义、索引、is_default，防多 head）
- task-02: `LlmProvider` model + schema（Create / Update / Read；含 cc-switch 核心字段 notes/website_url/auth_field/model_role_mappings/default_fallback_model/extra_env；api_key masked，X-09 规则）
- task-03: `LlmProviderService`（list / get / create / update / delete / set_default + 加解密 + is_default 互斥）
- task-04: router `/api/llm-providers` CRUD + main.py 挂载
- task-05: 后端单测（CRUD + 加密 + 权限隔离 + 设默认互斥）

## Wave 2：lease 下发

- task-06: `build_claim_payload` 加 `provider_config`（按 `lease.runtime_id → DaemonRuntime.user_id` 解析默认 provider，agent_kind 归一化 X-08，default_model 落点 X-10）
- task-07: ExecutionContextPayload / lease DTO 加 `provider_config` 字段
- task-08: 单测（有 provider / 无 provider 两路）

## Wave 3：daemon 注入器

- task-09: `credential-injector.ts`（CredentialInjector 接口 + ClaudeCredentialInjector + 注册表；ClaudeInjector 处理 auth_field 选择 / 角色映射→ANTHROPIC_DEFAULT_*_MODEL / 1M 后缀 / extra_env，D-010/D-011）
- task-10: `types.ts` LeaseCtx / ExecutionContextPayload 加 `provider_config`
- task-11: `spawn-env.ts` buildSpawnEnv 加第 0 层 + redactEnv 扩展（含 interactive 门控独立化 X-02，改 daemon.ts）
- task-12: daemon 单测（注入器 + 第 0 层 + 脱敏）

## Wave 4：前端

- task-13: 设置页「我的供应商」区块（列表 + 新建 / 编辑表单 + 设默认 + 删除，按设计系统）
- task-14: API 封装 + types + 单测

## Wave 5：集成 + 文档

- task-15: 端到端验证（配 provider → 跑 agent → 验证 env 注入 + 脱敏）
- task-16: local.yaml 加 `llm_provider` 子模块 + `.env.example` 补 `SILLYSPEC_MASTER_KEY` + 模块文档
