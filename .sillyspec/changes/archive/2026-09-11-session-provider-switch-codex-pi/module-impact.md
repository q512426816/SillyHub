# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon | sillyhub-daemon/src/provider-file-settings.ts | 新增（自 task-runner 平移 + ForReload 变体） | 是（reload 失败语义矩阵） |
| sillyhub-daemon | sillyhub-daemon/src/task-runner.ts | 调用关系变更（符号迁出改 import，调用点零改动） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/codex-settings.ts | 新增（mirrorCodexHostAuth / migrateCodexThreadFromHost 两 helper） | 是（宿主文件只读铁律） |
| sillyhub-daemon | sillyhub-daemon/src/interactive/types.ts | 接口变更（SessionManagerDeps 增可选 daemonApiKey） | 否（可选字段零破坏） |
| sillyhub-daemon | sillyhub-daemon/src/cli.ts | 逻辑变更（装配注入 daemonApiKey） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/interactive/session-manager.ts | 逻辑变更（reload 内核 codex/pi 文件层合并 + 迁移钩子 + 删 claude-only 守卫） | 是（核心链路） |
| sillyhub-daemon | sillyhub-daemon/src/interactive/session-manager/persistence.ts | 逻辑变更（restore 自愈注文件层 env + codex null 目录探测） | 是（恢复链路） |
| sillyhub-daemon | sillyhub-daemon/src/daemon.ts | 调用关系变更（import 改共享模块，调用点零改动） | 否 |
| frontend | frontend/src/lib/provider-caps.ts | 新增（PROVIDER_SWITCH_ENGINES 白名单常量） | 否 |
| frontend | frontend/src/components/sessions/session-config-bar.tsx | 逻辑变更（门禁白名单化 + kind 过滤 + 锁定文案中性化） | 是（FR-03 交互语义） |
| frontend | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 逻辑变更（错误卡门禁白名单化，保留 provider 空前置） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/daemon-provider-file-dispatch.test.ts | 逻辑变更（import 迁移） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts | 逻辑变更（import 迁移） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/provider-file-settings-reload.test.ts | 新增（ForReload 全分派矩阵 21 用例） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/daemon-provider-config-changed-handler.test.ts | 逻辑变更（D-003 接线断言补强） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts | 逻辑变更（REG-4 改写 + 迁移钩子矩阵） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/interactive/session-manager-reload-provider.test.ts | 逻辑变更（边界-2 改写 + pi 路径） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/interactive/session-recovery.test.ts | 逻辑变更（restore 四态 RESTORE-1..5） | 否 |
| frontend | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | 逻辑变更（解锁矩阵 + kind 过滤 + fixture 补 agent_kind） | 否 |
| frontend | frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx | 逻辑变更（门禁矩阵） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

无——CLI 预填的 19 个未匹配文件经逐行判定全部归入 sillyhub-daemon / frontend 两模块（见上矩阵；预填未匹配系双层 module-map 前缀口径差异，非游离文件）。task-04/06 涉及的 tests/interactive/session-recovery.test.ts、tests/cli-session-manager-injection.test.ts 与 execute 裁定内 credential-injector.ts 注释修正均已在 design 文件清单补列/登记。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 本变更不改模块边界（无新增模块/路径前缀变化）；R-03 口径同步（daemon 模块卡「热切换尽力重写」→「确定性 reload + daemon.ts:7713 幂等预写」）在归档 spec-sync 时更新 daemon 模块卡 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
