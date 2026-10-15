# 模块影响分析（Module Impact）— ZCode 引擎接入（第 5 交互引擎，单聊阶段 1）

> 文件×模块归属按 _module-map.yaml paths 前缀约定匹配；影响类型与 review 标记为语义判断，以最终 git diff 为准（真实 > 记录）。本版为归档终审版（对账基准 = worktree 分支 `main...HEAD` 实际 27 文件，execute 期事实修正已并入：前端单一源为 runtimes.ts 非 session-list-panel）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon/adapters | `sillyhub-daemon/src/adapters/zcode-envelope.ts`（NEW） | 新增（ZCode 私有协议信封层，独立文件不动 json-rpc.ts） | 是（协议正确性） |
| sillyhub-daemon/interactive | `sillyhub-daemon/src/interactive/zcode-app-server-driver.ts`（NEW） | 新增（InteractiveDriver 实现） | 是（驱动核心） |
| sillyhub-daemon/interactive | `sillyhub-daemon/src/interactive/zcode-events.ts`（NEW） | 新增（事件归一化器，含 turn.failed 收敛映射） | 是（事件映射正确性） |
| sillyhub-daemon/interactive | `sillyhub-daemon/src/interactive/thinking-levels.ts` | 逻辑变更（ENGINE_LEVEL_MATRIX 加 zcode 行，纯增量） | 否 |
| sillyhub-daemon/settings | `sillyhub-daemon/src/zcode-settings.ts`（NEW） | 新增（per-session 配置面写入器，照 codex-settings.ts 先例） | 是（密钥落盘姿势） |
| sillyhub-daemon/tests | `sillyhub-daemon/tests/interactive/zcode-envelope.test.ts`（NEW） | 新增（单测 13 例） | 否 |
| sillyhub-daemon/tests | `sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts`（NEW） | 新增（单测 11 例） | 否 |
| sillyhub-daemon/tests | `sillyhub-daemon/tests/interactive/zcode-events.test.ts`（NEW） | 新增（单测 14 例，实测 fixtures） | 否 |
| sillyhub-daemon/tests | `sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts`（NEW） | 新增（真机 e2e 冒烟，CI 无引擎 skip 留痕） | 否 |
| sillyhub-daemon/tests | `sillyhub-daemon/tests/zcode-settings.test.ts`（NEW） | 新增（写入器单测 10 例） | 否 |
| sillyhub-daemon/tests | `sillyhub-daemon/tests/agent-detector.test.ts` | 逻辑变更（守护断言 12→13 + zcode 三段式/execNode/版本门用例） | 否 |
| sillyhub-daemon/tests | `sillyhub-daemon/tests/version.test.ts` | 逻辑变更（MIN_VERSIONS 5 键 + zcode 版本门用例） | 否 |
| sillyhub-daemon/tests | `sillyhub-daemon/tests/interactive/provider-registry.test.ts` | 逻辑变更（键集/canary 加 zcode + family 同源比对批量缺席例外口径） | 否 |
| sillyhub-daemon/interactive | `sillyhub-daemon/src/interactive/providers.ts` | 接口变更（PROVIDER_CAPS zcode 十六键 + INTERACTIVE_PROVIDERS 注册 + fileSettings.dirName/perSessionDir 联合加宽） | 是（联合加宽与注册表守护） |
| sillyhub-daemon/detector | `sillyhub-daemon/src/agent-detector.ts` | 接口变更（AgentProviderSpec 可选 fallbackPaths/execNode + zcode 探测项 protocol='ndjson'） | 是（现有探测项零回归） |
| sillyhub-daemon/version | `sillyhub-daemon/src/version.ts` | 配置变更（MIN_VERSIONS 加 zcode (0,16,9)） | 否 |
| sillyhub-daemon/scripts | `sillyhub-daemon/scripts/gen-provider-caps.mjs` | 逻辑变更（ENGINES 加 zcode，三端镜像刷新） | 否 |
| sillyhub-daemon/api-types | `sillyhub-daemon/src/api-types.ts` | 数据结构变更（gen:types 生成物，规则 21 双义务） | 否（生成物） |
| backend/daemon | `backend/app/modules/daemon/schema.py` | 接口变更（InteractiveProviderLiteral 加 "zcode"，openapi 透出） | 是（枚举扩展面） |
| backend/openapi | `backend/openapi.json` | 数据结构变更（dump_openapi 重生成，544 paths/751 schemas） | 否（生成物） |
| backend/agent | `backend/app/modules/agent/provider_caps.py` | 配置变更（gen-provider-caps.mjs 镜像刷新，生成物） | 否（生成物） |
| backend/agent/tests | `backend/app/modules/agent/tests/test_provider_caps_alignment.py` | 逻辑变更（EXPECTED_PROVIDERS 加 zcode） | 否 |
| api-types（frontend） | `frontend/src/lib/api-types.ts` | 数据结构变更（gen:types 生成物） | 否（生成物） |
| frontend/lib/daemon | `frontend/src/lib/daemon/runtimes.ts` | 逻辑变更（SESSION_SUPPORTED_PROVIDERS/PROVIDER_META 加 zcode——execute 期事实修正：单一源在此，原 design 误列 session-list-panel） | 否（枚举追加） |
| frontend/lib/daemon tests | `frontend/src/lib/daemon/__tests__/runtimes.test.ts`（NEW） | 新增（白名单直测 4 例，真实模块不 mock） | 否 |
| frontend/sessions tests | `frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx` | 逻辑变更（断言面闸门连带：zcode 十六键全对象钉板） | 否 |
| frontend/lib（生成物） | `frontend/src/lib/provider-caps.ts` | 配置变更（gen-provider-caps.mjs 镜像刷新，生成物） | 否（生成物） |

## 未匹配文件

无——27 个交付文件全部命中既有模块路径前缀（与上表逐一对账一致）。

## 更新结果

| 目标 | 状态 | 说明 |
|---|---|---|
| `modules/sillyhub-daemon.md` | done | 交互引擎清单/驱动注册面补 zcode 条目（归档语义收尾同步） |
| `modules/backend.md` | done | 交互 provider 枚举白名单补 zcode（归档语义收尾同步） |
| `modules/frontend.md` | done | 单聊引擎白名单单一源补 zcode（归档语义收尾同步） |
| `_module-map.yaml: sillyhub-daemon` | skipped | 新增文件均命中既有模块前缀（adapters/interactive/settings/tests），无需新归类 |
| `_module-map.yaml: backend` | skipped | 同上（daemon/agent 既有前缀） |
| `_module-map.yaml: frontend` | skipped | 同上（lib/daemon、sessions 既有前缀） |

## 跨模块影响说明

- **dsh 变更交叠面**：providers.ts / agent-detector.ts / version.ts / schema.py / caps 两镜像为两变更共同修改文件，均为各自增量条目（dsh 加 dsh 条目、本变更加 zcode 条目；联合类型加宽双方可并）；messages.py 群附件门控明确不在本变更（归 dsh task-06）。
- **零改动红线（git 事实核验通过）**：`sillyhub-daemon/src/adapters/json-rpc.ts`（codex 生产路径，D-007）与批量层 `src/adapters/index.ts` PROVIDER_TO_PROTOCOL 表零触碰；无新增 npm 依赖。
- **生成物链**：schema.py（producer）→ openapi.json → 前端/daemon api-types（consumer）；providers.ts PROVIDER_CAPS（producer）→ gen-provider-caps.mjs → backend/frontend caps 镜像（consumer）。
