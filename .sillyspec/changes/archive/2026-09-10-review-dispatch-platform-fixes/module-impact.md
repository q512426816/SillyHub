# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | backend/app/modules/llm_provider/schema.py | 接口变更（DTO 值域：agent_kind +pi、auth_field 三处泛化 env 名 pattern；零 DDL） | 是（task-04 review.json pass） |
| backend | backend/app/modules/mcp_gateway/tools.py | 接口变更（get_daemon_status MCP 响应纯增量三键） | 是（task-06 review.json pass） |
| backend | backend/app/modules/mcp_gateway/tests/test_tools_new.py | 新增（3 既有用例补新键断言 + 4 新用例） | 否 |
| backend | backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py（NEW） | 新增（29 用例纯 schema 校验） | 否 |
| backend | backend/openapi.json | 配置变更（生成物随 schema 再生成） | 否 |
| frontend | frontend/src/components/llm-providers/llm-provider-form.tsx | 逻辑变更+接口变更（pi 选项启用、auth_field 输入泛化） | 是（task-07 review.json pass） |
| frontend | frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx | 新增（4 新用例 + lib 级断言；既有断言零改动） | 否 |
| frontend | frontend/src/lib/api/llm-providers.ts | 接口变更（别名放宽 + formToCreate 撤 agent_kind 硬编码，execute 期扩 scope） | 是（task-07 review.json pass） |
| frontend | frontend/src/lib/api-types.ts | 配置变更（生成物再生成） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/interactive/pi-rpc-driver.ts | 逻辑变更（turnFinalText 轮终全文进 success result） | 是（task-01 review.json pass） |
| sillyhub-daemon | sillyhub-daemon/src/hub-client.ts | 接口变更（workerDone 可选第 4 参 opts.sessionId） | 是（task-02 review.json pass） |
| sillyhub-daemon | sillyhub-daemon/src/daemon.ts | 逻辑变更+接口变更（ClientLike 可选 workerDone 成员 + onTurnResult 代报分支） | 是（task-03 review.json pass） |
| sillyhub-daemon | sillyhub-daemon/src/credential-injector.ts | 新增（PiCredentialInjector + REGISTRY 注册） | 是（task-05 review.json pass） |
| sillyhub-daemon | sillyhub-daemon/src/api-types.ts | 配置变更（生成物再生成） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts（NEW） | 新增（6 用例） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/hub-client-worker-done-session.test.ts（NEW） | 新增（6 用例） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts（NEW） | 新增（12 用例） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/credential-injector-pi.test.ts（NEW） | 新增（20 用例） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/credential-injector.test.ts | 逻辑变更（注册表用例连带更新：pi 移出未知 kind 断言） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

（无——plan --done 生成时 16 文件被判未匹配属生成期路径解析问题：根 map 实际存在 backend（:15）/frontend（:45）/sillyhub-daemon（:68）三个模块条目且 paths 覆盖全部上述文件，已在上方矩阵手工归类，索引本身无需增改。）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需 rebuild：根 map 三模块条目已覆盖本变更全部文件（未匹配为生成期路径解析问题，非索引过期） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
