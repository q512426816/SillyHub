---
author: qinyi
created_at: 2026-07-26 00:10:00
---

# 验证报告（Verify Result）— LLM 供应商管理

## 验证结论

✅ **通过** — 14 task 全部完成、三端 106 用例全绿、对照设计 9 项 pass、决策 D-001~012 全闭环、无阻塞缺陷。实现已 commit（4a6eb25d，48 文件 +5710 行）。

## 测试结果（commit 后主工作区实测）

| 端 | 测试 | 结果 |
|---|---|---|
| backend | pytest llm_provider + lease | **30 passed**（llm_provider 24 + lease 6） |
| backend | mypy app | Success（501 文件无 issue） |
| backend | ruff check / format | All passed |
| daemon | vitest credential-injector + spawn-env | **52 passed**（29 + 23） |
| daemon | tsc --noEmit | Success |
| frontend | vitest llm-providers | **24 passed**（api + form） |
| frontend | tsc --noEmit | Success |

三端 **106 用例全绿**，零回归。

## Runtime Evidence（集成证据）

本变更触发 integration-critical（含 lease/daemon/session/agent_run/state transition/claim），真实集成证据如下（非纯函数单测，均走真实 DB / 真实加解密 / 真实 lease 解析路径）：

### backend 集成：lease 下发链路（真实 DB 夹具）
- task-07 `test_provider_config_payload.py`（6 用例，实测 6 passed）：真实 AsyncSession + DaemonRuntime/AgentSession/LlmProvider DB 行夹具，验证 `build_claim_payload` 完整路径：
  - `lease.runtime_id → DaemonRuntime.user_id` 主路径真实查询（daemon/model.py:144，非 mock）
  - `provider_config` 8 字段齐全 + api_key 经 `core/crypto.py` 真实 `CredentialCipher.decrypt` 解出明文
  - 未配 → absent（D-007）；`agent_type=claude_code` 经 `_normalize_lease_provider` 归一化命中；AuditLog 无明文/无 provider_config（R-02）
  - 覆盖 interactive + batch 两路 lease kind

### daemon 集成：注入器 → spawn-env 第0层 → env
- task-10 `credential-injector.test.ts` + `spawn-env.test.ts`（52 用例，实测 52 passed）：验证 provider_config → ClaudeInjector.toEnv → ANTHROPIC_* env → buildSpawnEnv 第0层注入全链路：
  - 6 条映射规则（base_url / auth_field 选择不双写 / default_fallback / 4 角色映射→ANTHROPIC_DEFAULT_*_MODEL / one_m `[1m]` 后缀 / extra_env）
  - 第0层盖过 tool_config.env + credentials.json + process.env 同名 key；未配逐字一致零回归（D-007）；redactEnv 脱敏 ANTHROPIC_AUTH_TOKEN/API_KEY（R-02）

### spike-01：claude code env 实证（官方文档）
- `ANTHROPIC_DEFAULT_FABLE_MODEL` 官方收录（Fable 5），HAIKU/SONNET/OPUS/FABLE 四角色全实证（code.claude.com/docs/en/env-vars）
- `[1m]` 后缀触发 1M 上下文（官方示例 `claude-opus-4-8[1m]`，code.claude.com/docs/en/model-config）
- 结论落 `credential-injector.ts` 头部注释

### 真 claude 端到端（留部署）
真起 claude 进程 env dump + 真实对话调通 + PG `alembic upgrade` 建表 留部署/集成环境（需 API key + PG + daemon 进程 + 网络）。本机已验证逻辑链路（backend lease 解析 → daemon injector → env 映射），最后一跳（claude 进程读 env）由 claude code 原生 env 机制保证（spike-01 实证 env 优先级 + deploy/.env.example 已用 ANTHROPIC_DEFAULT_*_MODEL 跑通 glm-5.2 中转）。

## 任务完成度

14/14 = **100%**（plan.md checkbox 全勾）：
- Wave1 后端基础（task-01~05）：表+model+schema+service+router+单测 ✅
- Wave2 lease 下发（task-06~07）：build_claim_payload provider_config + 单测 ✅
- Wave3 daemon 注入器（task-08~10）：credential-injector + spawn-env 第0层 + 单测 ✅
- Wave4 前端（task-11~12）：供应商管理页 + API + 单测 ✅
- Wave5 集成文档（task-13~14）：端到端验证记录 + local.yaml + env.example + 模块卡 ✅

## 对照设计（execute step10 QA + verify step4 复审）

9 项 checklist 全 pass：
1. model.py 字段与 §7 1:1 ✅
2. schema.py 字段 + masked + Literal auth_field ✅
3. lease provider_config 8 字段齐全 ✅
4. ClaudeCredentialInjector 6 条映射 ✅
5. 生命周期契约 R-02 不回传 api_key ✅
6. 数据模型 加密/互斥/索引 ✅
7. 兼容 D-007 未配兜底零回归 ✅
8. 风险 R-01/R-02/R-04/R-05 处理 ✅
9. 非目标 D-012 反代未做 ✅

## 自动探针（verify step4）

- **探针 1（TODO/FIXME）**：变更源码 grep 无匹配 ✓
- **探针 3（测试覆盖）**：6 测试文件覆盖各层（backend 2 + daemon 2 + frontend 2）✓
- **探针 4（决策闭环）**：D-001~012 → FR → task，plan 覆盖矩阵全闭环 ✓

## spike-01 结论（已实证）

- `ANTHROPIC_DEFAULT_FABLE_MODEL` 官方文档收录（Fable 5），四角色（SONNET/OPUS/FABLE/HAIKU）全实证 — 无需降级
- `[1m]` 后缀触发 1M 上下文（官方示例 `claude-opus-4-8[1m]`）
- 来源：code.claude.com/docs/en/env-vars + model-config，结论落 credential-injector.ts 注释

## 问题 / 遗留（无阻塞）

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | baseline overlay 把 daemon-borrow-for-business 另一变更 apply 回主工作区 | 已处理 | commit 时筛选只提交本变更（4a6eb25d 仅 48 本变更文件），daemon-borrow 留工作区给其作者 |
| 2 | migrations/env.py 未注册 LlmProvider（landmine） | 已修 | 补 `from app.modules.llm_provider import model` 一行（commit 含） |
| 3 | baseline host_fs:604 Unused type:ignore（mypy 拦 commit） | 已修 | 删 type:ignore（留工作区 baseline，未入本 commit） |
| 4 | test_llm_provider.py:393 unused variable b（ruff） | 已修 | 删赋值（commit 含） |
| 5 | datetime.utcnow deprecation warning | 接受 | 照 git_identity 范式，非阻塞 |
| 6 | 真 claude 端到端 + PG alembic upgrade | 留部署 | 单测+spike 已覆盖逻辑链路，真实 claude 进程 env dump 留部署/集成环境 |

## 决策闭环

D-001（SSOT）/ D-002（用户级）/ D-003（纯自定义）/ D-004（env 注入）/ D-005（lease 下发）/ D-006（agent_kind+injector 抽象）/ D-007（未配兜底）/ D-008（owner 权限）/ D-009（复用 crypto+git_identity）/ D-010（cc-switch 字段集）/ D-011（角色映射 env）/ D-012（反代不做）— 全部 decided 且实现覆盖，无 unresolved。

## 下一步

verify 通过，可进 archive（归档变更）。
