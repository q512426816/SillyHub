# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon interactive | providers.ts、driver.ts、types.ts、session-manager.ts、session-manager/thinking-level.ts（NEW）、thinking-levels.ts（NEW）、pi-rpc-driver.ts、claude-sdk-driver.ts、codex-app-server-driver.ts、daemon.ts | 接口变更+逻辑变更+新增（caps 第 13 键；可选两契约方法+StartOptions；词表矩阵单源；守卫；三 driver 实现+两 RPC handler+全链透传） | 否（daemon 284 绿+typecheck 0） |
| sillyhub-daemon 测试 | thinking-levels.test.ts（NEW）、session-thinking-level.test.ts（NEW）、pi-rpc-driver.test.ts、codex-app-server-driver.test.ts、provider-registry.test.ts、provider-adapter-registry.test.ts | 逻辑变更（映射矩阵 28 格+守卫+三 driver 断言） | 否 |
| backend daemon | schema.py、session/service/create.py、session/service/thinking_level.py（NEW）、router/session_crud.py、router/__init__.py、agent/placement.py、daemon/lease/context.py | 接口变更+新增（三 DTO+全链透传+GET/POST 两端点+_ENDPOINT_ORDER） | 否（23 用例+mypy 273 文件 0） |
| backend agent | provider_caps.py、test_provider_caps_alignment.py | 配置变更（@generated 十三键+守护） | 否（4 绿） |
| 契约产物 | openapi.json、frontend/src/lib/api-types.ts | 接口变更（gen:types 新端点+DTO） | 否 |
| frontend | provider-caps.ts、lib/daemon/sessions.ts、session-config-bar.tsx、session-panel-page.tsx、session-config-bar.test.tsx | 逻辑变更+配置变更（caps 产物/两 API/档位下拉/切换控件/测试） | 否（109 绿+tsc+eslint 0 error） |
| docs | agent-provider-onboarding.md | 文档（thinking_level 指引+十三键） | 否 |


## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

（无——全部变更文件归属既有模块，骨架未匹配系生成器映射版本差异非索引过期）
## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需增改——全部文件归属既有模块（骨架未匹配系生成器映射版本差异） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
