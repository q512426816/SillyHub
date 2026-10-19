---
author: agent
created_at: 2026-10-19T01:38:39.773Z
---
# 设计记录（Design Record）— 2026-10-19-host-settings-live-reload

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

新增 daemon 模块 `sillyhub-daemon/src/interactive/host-settings-watcher.ts`：轮询宿主机
`~/.claude/settings.json`（默认 3s，`setInterval` + `unref`，跨平台零依赖），对 **env 块**做稳定
指纹（键排序后 `JSON.stringify`）；「新指纹连续两个轮询周期一致且 ≠ 基线」才算确认变化（去抖，
抵御 cc-switch 原子替换/半写），确认后回调。非 env 字段（permissions/hooks 等）变化、文件缺失、
JSON 损坏一律不触发不抛（跳过本轮，下轮自愈）。启动第一拍只建基线不触发。

`SessionManager` 新增公开方法 `reloadHostDefaultSessions(reason)`：遍历会话表，筛出
「claude 引擎 + 未绑平台供应商（providerConfig == null）+ 有 agentSessionId + 非终态 +
transcript 实际位于宿主目录（`locateClaudeTranscript === 'host'`——与 resume/reload 判定
CLAUDE_CONFIG_DIR 的同一单一来源：宿主目录 transcript ⟺ 引擎读宿主配置）」的会话，逐个调
**既有** `markPendingConfigSwitch`，载荷为 config-only（profile=null 不切人格、providerConfig
缺席不切供应商、prompt 空不喂轮）——即完全复用既有切换状态机：空闲立即 `reloadWithConfig`
（重建 env + `--resume` 同一会话）、运行中挂 `pendingConfigSwitch` 到轮边界（不打断当前轮）、
失败回滚旧句柄（R-01）、per-session 串行（`_reloadChains`）。引擎重载后按当前宿主档位重新
解析网关与模型，`/model` 会话级钉随旧进程消亡。方法为 async（逐会话探测 transcript 位置），
watcher 回调 fire-and-forget 调用。watcher 在 `SessionManager.start()` 起、`stop()` 停
（daemon.ts :2439 已调 start，零 daemon.ts 改动）。

不选「daemon 注入 env 强制覆盖模型」：平台无法知道宿主档位的正确模型语义，且会压住用户显式配置。
不选「请求期代理改写」：越权面/性能面不可控（上一变更同款否决理由）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

daemon 内部模块，**无对外契约变化**（无 HTTP/WS 契约、无 DB 字段、无前端类型 → 不需要
`pnpm gen:types`，`backend/openapi.json` 与两端 `api-types.ts` 零改动）。

新增导出（`host-settings-watcher.ts`）：

```ts
/** 宿主 settings.json 默认路径（<homedir>/.claude/settings.json）。 */
export function defaultHostSettingsPath(): string;

/** env 块稳定指纹；JSON 解析失败/非对象返回 null（调用方按「本轮跳过」处理）。 */
export function envBlockFingerprint(text: string): string | null;

export interface HostSettingsWatchOptions {
  settingsPath: string;              // 必填（测试注入 tmp 路径；生产 defaultHostSettingsPath()）
  pollIntervalMs?: number;           // 默认 3000
  onChange: (fingerprint: string) => void;
}

/** 起监听；返回句柄（stop() 清定时器，幂等）。定时器 unref，不阻塞进程退出。 */
export function startHostSettingsWatcher(opts: HostSettingsWatchOptions): { stop(): void };
```

`SessionManager`（`src/interactive/session-manager.ts`）：

```ts
/** 宿主档位变化 → 本机默认会话引擎批量重载；返回受影响会话数（异步：逐会话探测位置）。 */
reloadHostDefaultSessions(reason: string): Promise<number>;
```

`SessionManagerOptions` 新增可选 `hostSettingsWatch?: { enabled?: boolean; settingsPath?: string;
pollIntervalMs?: number }`（缺省 enabled=true；测试注入 tmp 路径与小间隔）。行为面：`start()` 起
watcher、`stop()` 停；环境阀 `SILLYHUB_HOST_SETTINGS_WATCH=0` 显式关闭（逃生口，读一次于 start 时）。
触发后日志 `console.warn('[session-manager] host_settings_change_reload', { reason, sessions: n })`
（n=0 不打）。config-only 载荷复用 `SessionSwitchConfigPayload`，对 `reloadWithConfig` 的语义：
profile=null（保留人格）、providerConfig 缺席（保留现值，本机默认即 null）、claimToken/prompt 空串
（不刷 token、不喂轮、不动 run 状态）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. **乱序/迟到到达**：轮询天然单调；「新指纹连续两拍一致」去抖保证半写/原子替换中途的瞬时态不会
   触发（中途读到的损坏 JSON → 指纹 null → 本轮跳过，不污染候选态：候选仅在拿到非 null 指纹且与
   上一拍候选一致时累计）。基线在启动第一拍建立，此后只在确认变化时推进——乱序不可能（单定时器串行）。
2. **并发写**：watcher 只读文件；与 cc-switch 写并发最坏读到半文件（解析失败跳过）或旧全文（下拍
   追上）。回调侧 `reloadHostDefaultSessions` 只遍历内存表 + 调既有切换状态机；同会话两次触发由
   `_reloadChains` 串行化、`pendingConfigSwitch` 覆盖写幂等（既有语义）。watcher 回调本身同步返回
   （reload fire-and-forget），不会重入堆叠。
3. **切换/生命周期**：运行中会话不打断（挂 pending 到轮边界，既有语义）；reload 失败回滚旧句柄
   （R-01）；`stop()` 停 watcher（daemon 关停顺序在 WS close 前，同 idle timer）；会话终态
   （ended/failed）与首 turn 未完成（无 agentSessionId）跳过；被 `SILLYHUB_HOST_SETTINGS_WATCH=0`
   关闭时零行为（等价变更前）。重载不改 transcript 位置（host 会话迁移分支两向均 no-op）、不触发
   上一变更的清洗（providerSwitchPayload=false）。
4. **作用域**：只读宿主机当前用户 `~/.claude/settings.json` 一个文件；只影响本 daemon 进程内、
   「本机默认 + 宿主目录 transcript（locateClaudeTranscript==='host'，与 resume 同一判定源）」
   会话；平台供应商会话（隔离 env）与隔离目录 transcript 会话零串台，其它机器/实例零影响。
   跨工作区无差别（档位是机器级事实，本机默认会话本就共享它）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **最大风险**：换档瞬间的批量重载会让所有本机默认会话引擎各重启一次（每个约 1-3s、各会话独立
  并行）；正在等用户输入的会话无感（下一轮才用新引擎），运行中会话延迟到轮边界。可接受——比
  「模型烙死 + 跨供应商 400」轻得多；且有关闭阀。
- **风险 2**：若用户以非 cc-switch 方式频繁改 settings.json 的 env 块（如脚本），会周期性触发重载。
  去抖（两拍一致）+ 3s 节拍已把频率压到「真实变化」粒度；重载本身幂等无害。
- **死路 1（放弃）**：daemon 注入 env 覆盖模型/网关——平台不知道宿主档位语义，且实验实证 settings
  的 base_url 本来就每轮热生效，注入反而制造新的钉。
- **死路 2（放弃）**：fs.watch（事件式）——Windows 下 cc-switch 若走替换写会掉 watch/漏事件，
   还需目录级 watch 兜底；轮询+指纹在 2-6KB 文件上成本可忽略且行为确定（跨平台一致性优先，
   CLAUDE.md 规则 13）。
- **死路 3（放弃）**：只做 UI 提示不改行为——用户已明确要免手动处理。
- **遗留（明确不在本变更范围）**：宿主机档位变化对「运行中那一轮」仍不生效（轮边界语义，与平台内
  切供应商一致）；`/model` 钉在重载后清零属预期副作用（正是解钉手段）。
