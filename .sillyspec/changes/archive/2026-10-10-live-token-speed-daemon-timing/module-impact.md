# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| interactive | `sillyhub-daemon/src/interactive/codex-app-server-driver.ts` | 逻辑变更（生成窗口计时 + usage 搭车，对外契约可选键追加） | 已审（execute QA 双 pass） |
| types | `sillyhub-daemon/src/types.ts` | 数据结构变更（AgentEventUsage 可选字段 api_duration_ms 追加，非破坏） | 已审（execute QA 双 pass） |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `sillyhub-daemon/src/agent-event-schema.ts` → 归属 interactive 契约层（daemon 模块卡 schema 段）：usage schema 可选键放行，逻辑变更
- `sillyhub-daemon/src/interactive/claude-events.ts` → 归属 interactive（claude 归一化器）：桶计时逻辑变更
- `sillyhub-daemon/src/interactive/pi-rpc-driver.ts` → 归属 interactive（pi driver）：窗口计时逻辑变更
- `backend/app/modules/daemon/run_sync/service/submit_steps.py` → 归属 backend daemon 模块（run_sync 摄取）：提取逻辑变更
- `backend/app/modules/daemon/run_sync/service/submit_commit.py` → 归属 backend daemon 模块（run_sync 持久化/发布）：仅增不减写回 + intent 透传，逻辑变更
- `backend/app/modules/daemon/run_sync/service/publish.py` → 归属 backend daemon 模块（PublishIntent + SSE 发布）：接口变更（事件新可选键，None 不带键向后兼容）
- `frontend/src/lib/daemon/session-sse.ts` → 归属 frontend lib/daemon SSE 域：envelope 注释语义更新（类型已存在，零结构变化）
- `frontend/src/components/daemon/turn-speed.ts` → 归属 frontend components-daemon：门控语义变更（上变更新增文件，本变更改写）
- `frontend/src/components/daemon/session-panel/session-panel-page.tsx` → 归属 frontend SessionPanel（app-sessions-pages/components-daemon 卡）：onTokens 一行接线，逻辑变更
- `frontend/src/components/daemon/session-panel/session-panel-dialog.tsx` → 归属 frontend SessionPanel：同上
- `frontend/src/components/daemon/__tests__/turn-speed.test.ts` → 测试（归属 components-daemon）：门控语义改写
- `frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx` → 测试（归属 components-daemon）：运行中实时用例
- `sillyhub-daemon/tests/interactive/claude-events.test.ts` → 测试（归属 interactive）：计时/契约用例
- `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts` → 测试（归属 interactive）：窗口用例
- `sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts` → 测试（归属 interactive）：折叠用例
- `backend/app/modules/daemon/tests`（test_run_sync_ctx_tokens.py）→ 测试（归属 backend daemon 模块）：摄取/下发用例

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/interactive.md` | interactive 无独立卡文件——同步落 docs/SillyHub/modules/daemon.md 文末增量节（三引擎逐调用计时 + usage 契约 api_duration_ms） | done |
| `modules/types.md` | types 无独立卡文件——AgentEventUsage 可选字段追加随 interactive 增量节记录（docs/SillyHub/modules/daemon.md） | done（并入上卡） |
| `modules/daemon.md`（backend） | run_sync 摄取链补维段（api_duration_ms→duration_api_ms 仅增不减 + SSE 增键） | done |
| `modules/components-daemon.md`（frontend） | tokens 事件新键 + turn-speed 门控语义段 | done |
| `_module-map.yaml` | 无需 rebuild：16 个未匹配文件逐个判定均属既有模块卡范围（daemon interactive / backend run_sync / frontend daemon 域），未命中系前缀粒度非索引缺失 | done（判定完成，索引零改动） |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
