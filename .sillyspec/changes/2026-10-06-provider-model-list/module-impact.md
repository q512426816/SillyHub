---
author: qinyi
created_at: 2026-10-07 09:15:00
---

# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。
> 判定基线：worktree `git diff 9c36d1cea..768f374da`（69 文件 +1546/-1189；2026-10-07 verify 回填）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| components-agent-profile | `frontend/src/components/agent-profile-form.tsx` | 无实际改动（design 声明清单列名但 worktree diff 为空——真实 > 声明） | 否 |
| lib-api | `frontend/src/lib/api-types.ts` | 接口变更（OpenAPI 生成物再生：LlmProvider* 三 DTO 切 models 契约，四旧字段键删除，+70 行） | 是（契约面，已由 gen:types 对账 + tsc 0 背书） |
| lib-llm-providers | `frontend/src/lib/api/llm-providers.ts` | 接口变更 + 逻辑变更（ProviderModelEntry 新类型；Read/Create/Update/FormValues 切模型列表；formToCreate/formToUpdate 映射器重写；cleanRoleMappings 退役） | 是（api 层契约 + 映射纯函数，llm-providers.test.ts 全绿背书） |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

**判定：全部为既有模块面内改动，非游离、索引无需增改**（本变更 0 新目录/0 新模块；backend/frontend 子项目内部细粒度归属见各自 docs 的模块卡——llm_provider/daemon/session_attachment 等）：

- `backend/migrations/versions/20261006200000_provider_models.py` backend 子项目（migrations 域，唯一 NEW 文件）
- `backend/app/modules/llm_provider/model.py` backend/llm_provider 既有模块
- `backend/app/modules/llm_provider/schema.py` backend/llm_provider 既有模块
- `backend/app/modules/llm_provider/service.py` backend/llm_provider 既有模块
- `backend/app/modules/llm_provider/router.py` backend/llm_provider 既有模块
- `backend/app/modules/llm_provider/litellm_client.py` backend/llm_provider 既有模块
- `backend/app/modules/daemon/lease/context.py` backend/daemon 既有模块
- `backend/app/modules/session_attachment/capability.py` backend/session_attachment 既有模块
- `backend/app/modules/daemon/session/service/inject_gates.py` backend/daemon 既有模块
- `backend/app/modules/daemon/session/service/create.py` backend/daemon 既有模块
- `backend/app/modules/agent/schema.py` backend/agent 既有模块
- `backend/openapi.json` 契约生成物（随 schema 变更再生）
- `frontend/src/components/llm-providers/llm-provider-form.tsx` frontend 既有组件（llm-providers 域）
- `frontend/src/components/sessions/session-config-bar.tsx` frontend/components-sessions 既有模块
- `frontend/src/components/sessions/ctx-usage-bar.tsx` frontend/components-sessions 既有模块
- `frontend/src/components/llm-providers/llm-provider-list.tsx` frontend 既有组件（llm-providers 域）
- `frontend/src/components/daemon/session-panel/session-panel-page.tsx` frontend/components-daemon 既有模块
- `frontend/src/components/daemon/session-panel/page-helpers.tsx` frontend/components-daemon 既有模块
- `backend/app/modules/daemon/attachment_pipeline.py` backend/daemon 既有模块
- `backend/app/modules/daemon/group/service/shadow.py` backend/daemon 既有模块
- `frontend/src/app/m/workspaces/[id]/sessions/[sid]/page.tsx` frontend/app-mobile-pages 既有模块
- `backend/app/modules/llm_provider/tests` backend/llm_provider 既有测试域（7 文件 fixture 切 models）
- `backend/app/modules/daemon/tests/test_resolve_default_provider_config.py` backend/daemon 既有测试
- `backend/app/modules/daemon/tests/test_resolve_bound_provider_config.py` backend/daemon 既有测试
- `backend/tests/modules/daemon/lease/test_provider_config_payload.py` backend 既有测试（折算+注入契约主承接）
- `backend/app/modules/session_attachment/tests/test_capability.py` backend/session_attachment 既有测试（门控三态重写）
- `frontend/src/components/llm-providers/__tests__` frontend 既有测试域（4 文件）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/components-agent-profile.md` | 不更新：worktree diff 实测该文件零改动（design 声明清单列名未触——真实 > 声明），卡内容仍准确 | skipped |
| `modules/lib-api.md` | 已更新：追加本变更条目（api-types.ts 契约再生日志） | done |
| `modules/lib-llm-providers.md` | 已更新：模型列表契约（models/ProviderModelEntry）+ 映射器语义变化条目 | done |
| `_module-map.yaml` | 不适用：本变更未新增模块/目录，全部为既有模块面内改动（backend/frontend 细粒度归属不变，索引无需 rebuild） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
