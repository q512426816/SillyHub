# 模块影响分析（agent 手写首版——module-map 无 diff 可归类，基于 design.md 文件变更清单）

> 文件×模块归属按 _module-map.yaml paths 前缀约定匹配；影响类型与 review 标记为语义判断，以最终 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon/adapters | `sillyhub-daemon/src/adapters/zcode-envelope.ts`（NEW） | 新增（ZCode 私有协议信封层，独立文件不动 json-rpc.ts） | 是（协议正确性） |
| sillyhub-daemon/interactive | `sillyhub-daemon/src/interactive/zcode-app-server-driver.ts`（NEW） | 新增（InteractiveDriver 实现） | 是（驱动核心） |
| sillyhub-daemon/interactive | `sillyhub-daemon/src/interactive/zcode-events.ts`（NEW） | 新增（事件归一化器） | 是（事件映射正确性） |
| sillyhub-daemon/settings | `sillyhub-daemon/src/zcode-settings.ts`（NEW） | 新增（per-session 配置面写入器，照 codex-settings.ts 先例） | 是（密钥落盘姿势） |
| sillyhub-daemon/tests | `sillyhub-daemon/tests/interactive/zcode-envelope.test.ts`（NEW） | 新增（单测） | 否 |
| sillyhub-daemon/tests | `sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts`（NEW） | 新增（单测） | 否 |
| sillyhub-daemon/tests | `sillyhub-daemon/tests/interactive/zcode-events.test.ts`（NEW） | 新增（单测） | 否 |
| sillyhub-daemon/interactive | `sillyhub-daemon/src/interactive/providers.ts` | 接口变更（PROVIDER_CAPS 加条目 + INTERACTIVE_PROVIDERS 加 ProviderAdapter + fileSettings.dirName/perSessionDir 联合类型加宽——dsh 变更同改可并） | 是（联合加宽与注册表守护测试） |
| sillyhub-daemon/detector | `sillyhub-daemon/src/agent-detector.ts` | 接口变更（AgentProviderSpec 扩展可选 fallbackPaths/execNode + 新增 zcode 探测项） | 是（现有 12 探测项零回归） |
| sillyhub-daemon/version | `sillyhub-daemon/src/version.ts` | 配置变更（MIN_VERSIONS 加 zcode (0,16,9)） | 否 |
| backend/daemon | `backend/app/modules/daemon/schema.py` | 接口变更（InteractiveProviderLiteral 加 "zcode"，openapi 透出） | 是（枚举扩展面） |
| api-types（daemon） | `sillyhub-daemon/src/api-types.ts` | 数据结构变更（gen:types 生成物，规则 21 双义务） | 否（生成物） |
| api-types（frontend） | `frontend/src/lib/api-types.ts` | 数据结构变更（gen:types 生成物） | 否（生成物） |
| frontend/sessions | `frontend/src/components/sessions/session-list-panel.tsx` | 逻辑变更（SESSION_ENGINE_OPTIONS 加 zcode 选项） | 否（枚举追加） |
| backend/agent（生成物） | `backend/app/modules/agent/provider_caps.py` | 配置变更（gen-provider-caps.mjs 镜像刷新，生成物） | 否（生成物） |
| frontend/lib（生成物） | `frontend/src/lib/provider-caps.ts` | 配置变更（gen-provider-caps.mjs 镜像刷新，生成物） | 否（生成物） |

## 未匹配文件

无——全部变更文件命中既有模块路径前缀。

## 更新结果

| 目标 | 状态 | 说明 |
|---|---|---|
| `modules/sillyhub-daemon.md` | pending | execute 完成（8 提交，daemon 6 新文件+4 修改）；verify 按实际 diff 回填 |
| `modules/backend.md` | pending | execute 完成（Literal 加宽 + caps 镜像 + 守护断言）；verify 回填 |
| `modules/frontend.md` | pending | execute 完成（白名单+META+钉子测试）；verify 回填 |
| `_module-map.yaml` | skipped | 新增文件（adapters/interactive 前缀）均命中既有模块前缀，无需新归类 |


## 跨模块影响说明

- **dsh 变更交叠面**：providers.ts / agent-detector.ts / version.ts / schema.py / session-list-panel.tsx / caps 两镜像为两变更共同修改文件，均为各自增量条目（dsh 加 dsh 条目、本变更加 zcode 条目；联合类型加宽双方可并）；messages.py 群附件门控明确不在本变更（归 dsh task-06）。
- **零改动红线**：`sillyhub-daemon/src/adapters/json-rpc.ts`（codex 生产路径，D-007）与批量层 `src/adapters/index.ts` PROVIDER_TO_PROTOCOL 表。
- **生成物链**：schema.py（producer）→ openapi.json → 前端/daemon api-types（consumer）；providers.ts PROVIDER_CAPS（producer）→ gen-provider-caps.mjs → backend/frontend caps 镜像（consumer）。
