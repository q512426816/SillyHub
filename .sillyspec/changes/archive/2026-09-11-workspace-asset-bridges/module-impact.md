# 模块影响分析（Module Impact）— 工作区↔平台资产桥

> 骨架由 plan --done 生成；影响类型与 review 标记为语义判断，以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| skill_source（backend） | model.py（workspace_id 列+双 partial）/service.py（toggle 双维度+adoptable/adopt+library 并集）/router.py（?workspace_id 参数） | 数据结构变更+接口变更（D-003/D-010 四处谓词） | 否（84+20 用例） |
| migrations（backend） | NEW:20260911220000_add_workspace_scope_enables.py | 数据结构变更（一列+双 partial，真实 PG 往返实测） | 否 |
| workspace（backend） | router.py（mcp import+adoptable/adopt 三端点）/skills_view_service.py（import_from_registry+adopt 两段）+ NEW:tests/test_skills_adopt.py+test_mcp_import_registry.py | 接口变更（三新端点 WORKSPACE_WRITE） | 否（441+347 用例） |
| mcp_registry（backend） | service.py（get_server_for_import）+schema.py（McpServerImportView DTO） | 接口变更（导入 helper） | 否（173 用例） |
| agent（backend） | skills_bundle_service.py（第三源并集+workspace_id 透传）+daemon/tests/test_skills_bundle.py | 逻辑变更（None 显式 IS NULL version hash 零变化） | 否（27 用例） |
| daemon（backend） | daemon_rpc.py（manifest/bundle ?workspace_id+授权门） | 接口变更（可选参数向后兼容） | 否（两态端点用例） |
| skill-manager（sillyhub-daemon） | skill-manager.ts（fetchRemoteManifest 可选 wsId+skills-workspaces 槽+syncWorkspaceGitSkills） | 接口变更+逻辑变更（槽隔离 D-007） | 否（37 用例） |
| daemon.ts/task-runner.ts（sillyhub-daemon） | 选槽调用点（全局 link→ws 解包→prune 序） | 调用关系变更 | 否（wiring 用例） |
| skills/mcp 页（frontend） | workspaces/[id] 两页+skills-library api+生成物三件 | 接口变更（两区块+弹窗） | 否（48 用例） |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths：

- `backend/migrations/versions/*` → migrations 模块 paths 写法（`migrations/**` 相对 backend 仓根）与 backend 侧全路径写法历史不一致——非索引过期；实际归 migrations 模块
- `backend/openapi.json`、`frontend/src/lib/api-types.ts`、`sillyhub-daemon/src/api-types.ts` → 生成物，归消费模块
- 其余文件全部命中上表模块（module-map 的 backend 子项目路径前缀已覆盖）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `.sillyspec/docs/backend/modules/_module-map.yaml` | 无需增改——本变更全部落在既有模块（skill_source/workspace/mcp_registry/agent/daemon）内，无新模块；未匹配文件属 migrations 路径写法历史不一致+生成物，非索引过期，无需 modules rebuild | done |
| `.sillyspec/docs/backend/modules/skill_source.md` 等模块卡 | 契约增量随归档产物留档（decisions D-002/003/007-010 已含语义；模块卡更新属可选收尾，不阻断） | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
