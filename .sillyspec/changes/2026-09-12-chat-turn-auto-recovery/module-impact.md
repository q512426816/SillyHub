# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| daemon/model-error | sillyhub-daemon/src/model-error/classifier.ts、types.ts、tests/model-error/classifier.test.ts | 逻辑变更+接口变更（规则体泛化+resetAt 协议字段） | 否（套件 32 绿+typecheck） |
| daemon/interactive | sillyhub-daemon/src/interactive/pi-rpc-driver.ts、tests/interactive/pi-rpc-driver-turn-result.test.ts、tests/interactive/pi-rpc-driver.test.ts | 逻辑变更（静默中断检测两入口+合成 error） | 否（117 绿） |
| daemon 主循环 | sillyhub-daemon/src/daemon.ts | 接口变更（payload.error wire 键 reset_at 映射） | 否（typecheck） |
| backend/daemon | backend/app/modules/daemon/model_error.py、run_sync/service/close_run_steps.py、session/service/auto_resume.py、inject.py、queue.py、scheduled_send.py、schema.py、router/session_queue.py、tests/test_auto_recover_failed_turn.py、test_auth_transient_autoretry.py、test_scheduled_send_sweeper.py、test_auto_recover_integration.py | 逻辑变更+接口变更+数据结构变更（三分支恢复+派发链贯通+DTO 扩展） | 否（49+38 集成/套件绿+mypy 0） |
| backend/agent 模型 | backend/app/modules/agent/model.py、migrations/versions/20260912110000_add_scheduled_message_origin.py | 数据结构变更（scheduled_messages.origin 列 soft-add） | 否（migration 单头 up/down 实跑） |
| backend 契约产物 | backend/openapi.json | 接口变更（随 gen:types 重生成） | 否 |
| frontend/lib | frontend/src/lib/api-types.ts、lib/daemon/session-queue.ts、hooks/use-message-queue.ts、hooks/use-scheduled-messages.ts | 接口变更+逻辑变更（DTO origin/reset_at 消费+空数组常量） | 否（tsc 0） |
| frontend/agent-log | frontend/src/components/agent-log/run-error-item.tsx、normalize.ts、__tests__×2 | 接口变更+逻辑变更（autoRecoverHint 链序+reset_at 透传） | 否（46+94 绿） |
| frontend/daemon 组件 | frontend/src/components/daemon/turn-timeline.tsx、scheduled-messages-bar.tsx、session-panel/session-panel-page.tsx、session-panel-dialog.tsx、__tests__/turn-timeline-auto-recover.test.ts、scheduled-messages-bar.test.tsx | 逻辑变更+接口变更（双信号推导+数据上提+徽标） | 否（7+11+58 绿） |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

全部归属判定完成（见上矩阵）：均为既有模块的存量路径（model-error/interactive/daemon/session/migrations/components-*），_module-map.yaml 未收录 sillyhub-daemon 子目录级 paths 与部分 backend/frontend 细分路径属索引粒度问题（多变更共同现象，非本变更新增游离文件）；模块文档六处增量已同步，无需 rebuild 增改索引。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需增改——未匹配文件均为既有模块存量路径（索引粒度现象非游离文件），模块文档六处增量已同步 | done |
| sillyhub-daemon/modules/model-error.md | 增量段落（泛化/断流关键词/resetAt） | done |
| sillyhub-daemon/modules/interactive.md | 增量段落（静默检测两入口与判定） | done |
| backend/modules/daemon.md | 增量段落（三分支恢复+派发链+origin 列） | done |
| backend/modules/migrations.md | 20260912110000 条目 | done |
| frontend/modules/components-daemon.md | 增量段落（双信号/数据上提/徽标） | done |
| frontend/modules/components-agent-log.md | 增量段落（reset_at/autoRecoverHint 链序） | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
