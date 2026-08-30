---
author: qinyi
created_at: 2026-08-30 17:52:30
---
# 模块影响分析（Module Impact）— daemon 自愈两连修

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| sillyhub-daemon:preflight | 修改 | 校验器三件套（MIN_BUNDLE_BYTES/validateBundleContent/validateBundleOnDisk）；downloadAndReplace 写入校验前置+.bak 备份轮换；respawnDaemonAndExit 最后防线（签名改 async Promise\<void\>）；runPreflight 增可选 binDir 第三参 |
| sillyhub-daemon:daemon | 修改 | 心跳恢复触发（720s 守卫+GAP-2 无外层门）；_maybeRecoverAfterDegraded 忙门控+pending 复查；_recoverSessionsOnBoot 参数化提取为 _recoverPersistedSessions(trigger)；_isBusyForUpdate 增恢复在途；401/403 分支补置 _heartbeatFailSince；_tryUpdate stop 前 validateBundleOnDisk 主拦截（GAP-1 顺序钉扎） |
| sillyhub-daemon:tests | 修改 | preflight.test.ts + preflight-download-replace.test.ts（binDir 隔离+fixture 合法化+新用例+hash 回归）；daemon-heartbeat-pending / integration/selfupdate-scenarios（触发/门控/401-403/互斥）；daemon-selfupdate-orchestrator（主拦截） |
| backend:* | 不变 | recover API 幂等语义/sweep/24h GC 全部复用现状，零改动 |
| frontend:* | 不变 | 无界面变化 |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| （无） | 全部改动文件均落在上述三个模块的 allowed_paths 白名单内（2 源码 + 5 测试） |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `docs/SillyHub/modules/sillyhub-daemon.md`（preflight/daemon 章节） | 更新心跳恢复通道与 selfupdate 三道防线说明 | pending（archive 阶段同步） |
| `_module-map.yaml` | 无变化（未增删模块/目录） | skipped |
