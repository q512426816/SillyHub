# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon | sillyhub-daemon/src/interactive/providers.ts | 接口变更（ProviderAdapter 扩展+writer 接口+caps 第 10 键） | 是（契约核心） |
| sillyhub-daemon | sillyhub-daemon/src/credential-injector.ts | 逻辑变更（REGISTRY 惰性派生） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/provider-file-settings.ts | 逻辑变更（两分派 writer 化） | 是（失败语义保真） |
| sillyhub-daemon | sillyhub-daemon/src/codex-settings.ts | 逻辑变更（门槛函数迁入） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/pi-settings.ts | 逻辑变更（门槛函数迁入） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/daemon.ts | 逻辑变更（三处收口读元数据） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/interactive/session-manager.ts | 逻辑变更（reload 门控收口） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/interactive/session-manager/persistence.ts | 逻辑变更（restore 门控收口） | 否 |
| sillyhub-daemon | sillyhub-daemon/scripts/gen-provider-caps.mjs | 新增（三端生成脚本） | 是（幂等+守卫） |
| frontend | frontend/package.json | 配置变更（gen:types 挂钩） | 否 |
| frontend | frontend/src/lib/provider-caps.ts | 新增形态（改生成产物+白名单派生） | 否 |
| backend | backend/app/modules/agent/provider_caps.py | 新增形态（改生成产物） | 否 |
| backend | backend/app/modules/agent/tests/test_provider_caps_alignment.py | 逻辑变更（键集合 9→10） | 否 |
| sillyhub-daemon | tests（provider-adapter-registry 新增/provider-registry/codex/pi-settings 表驱动） | 逻辑变更（守护+制度化） | 否 |

## 未匹配文件

无——CLI 预填未匹配文件全部归入 sillyhub-daemon/frontend/backend 三模块（见上矩阵；预填未匹配系双层 module-map 前缀口径差异）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 本变更不改模块边界；daemon 模块卡「聚合契约」条目随归档 spec-sync 补登（providers.ts main_symbols 已有 INTERACTIVE_PROVIDERS 条目，描述升格 ProviderAdapter 一句话） | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
