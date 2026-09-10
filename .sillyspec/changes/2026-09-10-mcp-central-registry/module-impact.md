# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| NEW:mcp_registry（backend） | NEW:backend/app/modules/mcp_registry/**（model/schema/service/router/render/importer/templates/tests） | 新增（三表+13 端点+渲染诊断+导入模板；全模块 153 单测） | 否（新模块独立审查已过：plan-review + execute 验收） |
| migrations（backend） | NEW:backend/migrations/versions/20260910140000_add_mcp_registry_tables.py（design 早期写 alembic/versions 系笔误）+ backend/migrations/env.py（模型登记补行） | 数据结构变更（三表+三索引，up/down 真实 PG 往返实测） | 否 |
| daemon（backend） | backend/app/modules/daemon/router/daemon_rpc.py（端点换源+user_id 授权）、lease/context.py（claim payload user_id 双键）、tests/test_mcp_config_endpoint.py（20 用例）、tests/test_build_claim_payload.py（U1-U4） | 接口变更（GET /api/daemon/mcp/config 加可选 user_id + lease 归属校验；响应形状不变 golden 锁定）+ 调用关系变更（platform 位数据源 KV→registry） | 否（授权三态+golden+回落链全覆盖） |
| settings（backend） | backend/app/modules/settings/router.py（删 GET/PUT platform-settings/mcp）、schema.py（删 McpServersSchema）、backend/tests/modules/settings/test_mcp_settings.py（7 旧用例删） | 接口变更（端点移除，D-003 零迁移）；whitelist 两端点与 _redact_mcp_env（workspace 侧 4 处消费）保留 | 否（消费者 grep 零残留） |
| frontend | page.tsx/page.test.tsx 重构、NEW:components/mcp-registry/*（6 组件）、NEW:lib/api/mcp-registry.ts、lib/mcp-settings.ts（删旧 config 客户端留 whitelist）、lib/query-keys.ts（死键清）、lib/menu-permissions.ts（更名+权限放开）、api-types.ts+openapi.json（gen:types） | 新增+接口变更（旧 JSON 编辑器→双 tab 资产管理页） | 否（11+38+21 前端用例） |
| sillyhub-daemon | src/daemon.ts（execPayload userId 归一化+预取传参）、src/mcp-config.ts（fetchMcpBundle user_id 参数）、tests/mcp-config.test.ts、NEW:tests/daemon-mcp-user-id-wiring.test.ts | 调用关系变更（拉取 URL 加可选 user_id；缺省不拼向后兼容；_mcpBundleBySession 结构不动） | 否（wiring 三态+60 用例） |
| backend 杂项 | backend/app/main.py（router 注册 7 行）、backend/conftest.py（模型注册 3 行） | 配置变更 | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `NEW:backend/app/modules/mcp_registry/**` → 新模块，task-13 已在 _module-map.yaml 增 mcp_registry 条目（索引已补）
- `NEW:backend/alembic/versions/xxxx_add_mcp_registry_tables.py` → design 笔误路径；实际为 backend/migrations/versions/20260910140000_*（migrations 模块 paths 前缀 `migrations/**` 未含 `backend/migrations` 前缀写法——归 migrations 模块，索引路径写法待 rebuild 归一）
- `backend/app/main.py` → 游离装配文件（router 注册区），非模块 paths 覆盖——正常（main.py 历来无模块归属）
- `frontend/src/app/(dashboard)/settings/mcp/page.tsx`、`frontend/src/components/mcp-registry`、`frontend/src/lib/api-types.ts`、`backend/openapi.json`、`sillyhub-daemon/src/*`、`backend/app/modules/{daemon,settings}/**` → 子项目级模块图（docs/frontend|sillyhub-daemon 各自 _module-map）覆盖；backend 侧 daemon/settings 文件未命中系本骨架只按主项目 module-map 匹配——非游离，各子项目模块卡（task-13 已更新 settings.md/daemon.md/mcp_registry.md）覆盖

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 已增 mcp_registry 条目（paths/tags/entrypoints/main_symbols/depends_on/used_by，照 skills 格式）+ settings 条目去旧端点 + daemon depends_on 补 mcp_registry（task-13 实改，git diff 可证）；backend/migrations 路径写法归一留 modules rebuild（归档阶段顺跑） | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
