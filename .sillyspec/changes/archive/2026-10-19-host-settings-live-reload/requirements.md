---
author: agent
created_at: 2026-10-19T01:38:39.773Z
---
# 需求规格（Requirements）— 2026-10-19-host-settings-live-reload

## 功能需求

### FR-01: 宿主机档位变化 → 本机默认会话引擎自动重载

daemon **必须**监听宿主机 `~/.claude/settings.json` 的 **env 块**指纹（轮询 + 连续两拍一致
去抖，跨平台零依赖）：确认变化后，对「claude 引擎 + 未绑平台供应商（providerConfig == null）
+ 有 agentSessionId + 非终态 + transcript 位于宿主目录」的会话**必须**自动重载引擎——完全复用
既有配置切换状态机（空闲立即 `reloadWithConfig`；运行中**禁止**打断当前轮，挂
`pendingConfigSwitch` 到轮边界；失败回滚旧句柄 R-01；per-session 串行）。重载后引擎按当前宿主
档位重新解析网关与模型，`/model` 会话级钉随旧进程消亡。

#### 场景：主路径——空闲本机默认会话即时跟随

Given 一个本机默认、宿主目录 transcript、空闲的 claude 会话，且 watcher 已建基线；
When 宿主 settings.json 的 env 块被换成新档位（如 GLM → MiniMax）且连续两拍一致；
Then 该会话引擎被重载（旧句柄 close、新句柄 `--resume` 同一 agentSessionId、env 重建），
无 prompt 喂入（不出新轮），且平台内会话状态不被破坏。

#### 场景：边界——运行中与终态

Given 同类会话正处于生成中（首 turn 未收尾）；
Then 标记 `pendingConfigSwitch`，当前轮不被打断，轮收尾后才重载；终态（ended/failed）与
首 turn 未完成（无 agentSessionId）会话**禁止**进入重载名单。

### FR-02: 触发精度与零误伤

**必须**仅以 env 块变化为触发条件：permissions/hooks 等非 env 字段变化、文件缺失、JSON 损坏
（半写）**必须**跳过（不触发、不抛异常，下拍自愈）；启动第一拍**必须**只建基线不触发；
平台供应商会话（providerConfig 非空）与隔离目录 transcript 会话**必须**零触碰（它们不读宿主
配置，重载无意义且会误伤隔离语义）；**必须**提供关闭阀 `SILLYHUB_HOST_SETTINGS_WATCH=0`
（opts 显式 `enabled:false` 同效），关闭时行为与变更前逐字一致。

#### 场景：精度——非 env 变化与损坏容错

Given watcher 已建基线；
When 仅改 permissions/hooks 字段、或写入半截 JSON、或删除文件；
Then 不触发任何重载且进程不抛异常；文件恢复且 env 块确有变化后照常确认触发。

### FR-03: 守护测试与真机验证留痕

**必须**有守护测试覆盖：watcher（基线不触发 / env 变化去抖后触发一次并携带新指纹 / 非 env
变化不触发 / 损坏与缺失容错 / stop 幂等停）+ 会话筛选矩阵（本机默认重载 / 平台供应商不重载 /
隔离目录不重载 / 运行中延迟到轮边界后重载）+ manager 集成（真实 `start()` 后改 tmp settings
文件触发自动重载、resume key 不变、无 prompt 喂入、关闭阀生效）；相关 daemon 测试与 `tsc`
**必须**全绿；部署后**必须**留真机验证痕（改档位 → daemon 日志 `host_settings_change_reload`
+ 下一轮按新档位出词）。

#### 场景：测试面全绿

Given 本变更两份测试文件与 interactive 套件；
When 跑 `vitest run tests/interactive` + `tsc --noEmit`；
Then 全绿零失败。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts「HOST-1 本机默认 + 宿主目录 transcript + 空闲 → 立即重载（resume 不变、不喂轮）」/「HOST-4 运行中会话 → 不打断当前轮，挂标记到轮边界后重载」/「HOST-5 集成——真实 start() 后宿主 settings env 变化 → watcher 触发自动重载」
FR-02: sillyhub-daemon/tests/interactive/host-settings-watcher.test.ts（8 例：指纹口径 / 基线不触发 / env 变化去抖触发 / 非 env 变化不触发 / 半写容错 / 缺失容错 / stop 幂等）+ session-manager-config-switch.test.ts「HOST-2 绑平台供应商的会话 → 零触碰」/「HOST-3 隔离目录 transcript（未绑供应商）→ 零触碰」/「HOST-6 关闭阀（env SILLYHUB_HOST_SETTINGS_WATCH=0）→ start 不起监听，变化零重载」
FR-03: 上述全部用例；实测：`vitest run tests/interactive` 78 文件 1234 例绿（+1 skipped）+ `tsc --noEmit` 零错；真机验证留痕随部署（改档位 → `host_settings_change_reload` 日志 + 下一轮新档位出词）——部署验证见发布记录
