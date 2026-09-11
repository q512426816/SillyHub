# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/skill_source/model.py` <!--TODO: 归属判定-->
- `backend/migrations/versions/xxxx_add_workspace_scope_enables.py` <!--TODO: 归属判定-->
- `backend/app/modules/skill_source/service.py` <!--TODO: 归属判定-->
- `backend/app/modules/skill_source/router.py` <!--TODO: 归属判定-->
- `backend/app/modules/workspace/router.py` <!--TODO: 归属判定-->
- `backend/app/modules/workspace/skills_view_service.py` <!--TODO: 归属判定-->
- `backend/app/modules/mcp_registry/service.py` <!--TODO: 归属判定-->
- `backend/app/modules/agent/skills_bundle_service.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/router/daemon_rpc.py` <!--TODO: 归属判定-->
- `sillyhub-daemon/src/skill-manager.ts` <!--TODO: 归属判定-->
- `sillyhub-daemon/src/daemon.ts` <!--TODO: 归属判定-->
- `sillyhub-daemon/src/task-runner.ts` <!--TODO: 归属判定-->
- `frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx` <!--TODO: 归属判定-->
- `frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/skills-library/skill-source-api.ts` <!--TODO: 归属判定-->
- `frontend/src/lib/api-types.ts` <!--TODO: 归属判定-->
- `backend/openapi.json` <!--TODO: 归属判定-->
- `sillyhub-daemon/src/api-types.ts` <!--TODO: 归属判定-->

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | <!--TODO: 有未匹配文件，判定模块索引是否需增改（modules rebuild）--> | pending |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
