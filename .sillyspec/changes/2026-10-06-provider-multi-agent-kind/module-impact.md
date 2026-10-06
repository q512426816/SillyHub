# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/migrations/versions/20261006120000_provider_agent_kinds.py` <!--TODO: 归属判定-->
- `backend/app/modules/llm_provider/model.py` <!--TODO: 归属判定-->
- `backend/app/modules/llm_provider/schema.py` <!--TODO: 归属判定-->
- `backend/app/modules/llm_provider/service.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/lease/context.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/lease/provider_switch.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/session/service/inject_gates.py` <!--TODO: 归属判定-->
- `backend/app/modules/session_attachment/capability.py` <!--TODO: 归属判定-->
- `backend/app/modules/mcp_gateway/tools.py` <!--TODO: 归属判定-->
- `backend/app/modules/agent/schema.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/protocol.py` <!--TODO: 归属判定-->
- `backend/openapi.json` <!--TODO: 归属判定-->
- `frontend/src/lib/api-types.ts` <!--TODO: 归属判定-->
- `frontend/src/lib/api/llm-providers.ts` <!--TODO: 归属判定-->
- `frontend/src/components/llm-providers/llm-provider-form.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/llm-providers/llm-provider-list.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/sessions/session-config-bar.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/agent-profile-form.tsx` <!--TODO: 归属判定-->
- `backend/app/modules/llm_provider/tests/test_llm_provider.py` <!--TODO: 归属判定-->
- `backend/app/modules/llm_provider/tests/test_api_format.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/tests/test_resolve_default_provider_config.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/tests/test_resolve_bound_provider_config.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/tests/test_provider_switch.py` <!--TODO: 归属判定-->
- `backend/tests/modules/daemon/lease/test_provider_config_payload.py` <!--TODO: 归属判定-->
- `backend/app/modules/session_attachment/tests/test_capability.py` <!--TODO: 归属判定-->
- `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx` <!--TODO: 归属判定-->
- `frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx` <!--TODO: 归属判定-->

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 不适用：本变更未新增模块/目录，模块索引无需增改（llm_provider/daemon/frontend 均为既有模块面内改动） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
