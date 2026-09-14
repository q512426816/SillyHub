# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon interactive | sillyhub-daemon/src/interactive/providers.ts、sillyhub-daemon/src/interactive/driver.ts、sillyhub-daemon/src/interactive/session-manager.ts、sillyhub-daemon/src/interactive/session-manager/compact.ts（NEW）、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/src/interactive/codex-app-server-driver.ts、sillyhub-daemon/src/daemon.ts | 接口变更+逻辑变更+新增（caps 第 12 键；CompactResult/compact?() 可选契约；session-manager compact 六守卫；pi driver compact 回执；codex pending response 机制+compact；daemon session_compact RPC handler 单点） | 否（相关面 229 绿+typecheck 0） |
| sillyhub-daemon 脚本与测试 | sillyhub-daemon/scripts/gen-provider-caps.mjs、sillyhub-daemon/tests/interactive/provider-registry.test.ts、sillyhub-daemon/tests/provider-adapter-registry.test.ts、sillyhub-daemon/tests/interactive/session-compact.test.ts（NEW）、sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts、sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | 配置变更+逻辑变更（12 键生成/守护同步/新测试） | 否 |
| backend daemon 模块 | backend/app/modules/daemon/router/session_crud.py、backend/app/modules/daemon/router/__init__.py、backend/app/modules/daemon/schema.py、backend/app/modules/daemon/session/service/compact.py（NEW） | 接口变更+新增（POST compact 端点双分路+DTO+_ENDPOINT_ORDER 机械必改） | 否（16 端点用例+mypy 944 文件 0） |
| backend agent 模块 | backend/app/modules/agent/provider_caps.py、backend/app/modules/agent/tests/test_provider_caps_alignment.py | 配置变更（@generated 12 键+守护） | 否（alignment 4 绿） |
| backend 契约产物 | backend/openapi.json、frontend/src/lib/api-types.ts | 接口变更（gen:types 新端点+DTO） | 否 |
| frontend lib 与组件 | frontend/src/lib/provider-caps.ts、frontend/src/lib/daemon/sessions.ts、frontend/src/components/sessions/ctx-usage-bar.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | 逻辑变更+配置变更（caps 产物/API 客户端/按钮三态/三分型通知/测试） | 否（63 绿+tsc+eslint 0 error） |
| docs | docs/agent-provider-onboarding.md | 文档（compact 分路指引+十二键） | 否 |


## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

（无——全部 22 个变更文件归属既有模块，见上方矩阵；骨架未匹配系生成器映射版本差异非索引过期）


## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需增改——全部文件归属既有模块（骨架未匹配系生成器映射版本差异） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
