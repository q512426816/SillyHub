# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| cli | `sillyhub-daemon/src/cli.ts` | 逻辑变更（isMainAgentSession 谓词内判定替换：claude 硬拒 → isMainAgentMcpCandidate caps 驱动；分身谓词零 diff） | 已随 task-04 单测 + QA 层核验 |
| codex-settings | `sillyhub-daemon/src/codex-settings.ts` | 新增（mergeCodexMcpToml + writeCodexMcpServers + CodexMcpServerConfig；既有 writeCodexHome 零 diff） | 已随 task-06 单测核验 |
| interactive | `sillyhub-daemon/src/interactive/codex-app-server-driver.ts` | 逻辑变更（start 内 MCP 写盘消费块，caps 未翻前不触达） | 已随 task-06 核验 |
| pi-settings | `sillyhub-daemon/src/pi-settings.ts` | 新增（PiMcpServerConfig + writePiMcpConfig；既有 writePiDir 零 diff） | 已随 task-05 单测核验 |

## 未匹配文件

- `sillyhub-daemon/src/interactive/providers.ts` → 归属 interactive：逻辑变更（isMainAgentMcpCandidate 新增导出 + PROVIDER_CAPS pi.mcp 翻 true + 三引擎注释改写新证据口径）
- `sillyhub-daemon/src/interactive/pi-rpc-driver.ts` → 同上：逻辑变更（start 消费 opts.mcpServers + 版本门控写盘降级块 + parsePiMajorVersion/detectPiMajorVersion；mcpServers 空时 spawn 主路径零行为变化）
- `sillyhub-daemon/src/interactive/cursor-driver.ts` → 同上：注释变更（忽略清单留档说明；零逻辑 diff）
- `sillyhub-daemon/vendor/pi-extensions/mcp-adapter` → 未落地（设计内取消）：SPIKE-00 裁定形态①原生配置，design 条目"形态①③时本条取消"兑现
- `sillyhub-daemon/tests/pi-settings-mcp.test.ts` → 新增测试（task-05，7 用例）
- `sillyhub-daemon/tests/codex-settings-mcp.test.ts` → 新增测试（task-06，7 用例）
- `sillyhub-daemon/tests/mcp-config.test.ts` → 测试扩展（task-04，+5 数据驱动矩阵用例）
- `frontend/src/lib/provider-caps.ts` → 生成产物（gen-provider-caps 重刷，pi.mcp true）
- `backend/app/modules/agent/provider_caps.py` → 生成产物（同上）
- `sillyhub-daemon/scripts/gen-provider-caps.mjs` → 零 diff（重跑消费，解析器对注释免疫已证）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/cli.md` | 更新cli模块卡 | skipped——模块卡同步归 archive 阶段统一执行（sillyspec-archive 义务：模块影响分析+同步模块文档）；行为变化已沉淀于本表与知识库 3 条 |
| `modules/codex-settings.md` | 更新codex-settings模块卡 | skipped——模块卡同步归 archive 阶段统一执行（sillyspec-archive 义务：模块影响分析+同步模块文档）；行为变化已沉淀于本表与知识库 3 条 |
| `modules/interactive.md` | 更新interactive模块卡 | skipped——模块卡同步归 archive 阶段统一执行（sillyspec-archive 义务：模块影响分析+同步模块文档）；行为变化已沉淀于本表与知识库 3 条 |
| `modules/pi-settings.md` | 更新pi-settings模块卡 | skipped——模块卡同步归 archive 阶段统一执行（sillyspec-archive 义务：模块影响分析+同步模块文档）；行为变化已沉淀于本表与知识库 3 条 |
| `_module-map.yaml` | 判定：无需 rebuild——未匹配文件全部归属既有 sillyhub-daemon 模块（首版未命中系 paths 前缀匹配口径，非索引过期） | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
