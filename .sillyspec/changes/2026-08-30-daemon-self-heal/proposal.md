---
author: qinyi
created_at: 2026-08-30 17:21:47
---

# 提案书（Proposal）

## 动机

2026-08-30 生产事故实证 daemon 自愈链两个缺口：①Windows 睡眠 >10 分钟导致
backend offline sweep 把 19 个活跃会话翻挂起后，daemon 进程未重启就永远无人
恢复（唯一恢复入口在 daemon 启动时），卡挂起 19 小时靠手工重启捞回，且超 24h
会被 GC 判死；②selfupdate 测试用例未隔离文件系统，把 `NEW BUNDLE BODY` 占位
文本写进生产 bin（8-30 00:11 实证），而下载链路无内容校验无备份，坏 bundle 被
拉起即 SyntaxError 起不来，本次靠部署遗留 .bak 手工恢复。

## 关键问题

1. **挂起会话无反向恢复通道**：sweep 是"进程存活却产生 suspended"的常态化
   来源（机器睡眠/网络闪断 >10 分钟），但恢复只挂在 daemon boot——进程不重启
   就没有恢复方，与"挂起可恢复"的设计语义（前作 resilience D-001）相悖。
2. **自更新链路对"内容可信"零防御**：tmp+rename 只保证原子性不保证内容正确；
   测试/外部写入/截断下载任何一路污染落盘，下一个被拉起的进程直接死，且无
   备份可回退（8-30 靠手工 .bak 纯属侥幸）。
3. **respawn 拦截语义有僵尸路径**（Grill 复审发现）：若只在 stop 后校验，拦截
   时进程已停摆且更新所有权永久占用，后续触发全被跳过——坏盘场景变成永久
   僵尸，比不拦截更糟。

## 变更范围

- `sillyhub-daemon/src/daemon.ts`：心跳恢复事件触发主动 recover（>720s 守卫 +
  忙门控推迟 + 401/403 补覆盖）；`_tryUpdate` stop 前 bundle 校验主拦截。
- `sillyhub-daemon/src/preflight.ts`：`validateBundleContent`/`validateBundleOnDisk`
  校验器；`downloadAndReplace` 写入校验 + .bak 备份轮换（保留 3 份）；
  `respawnDaemonAndExit` 拉起前校验最后防线；`runPreflight` 增可选 binDir 参数。
- `sillyhub-daemon/tests/preflight.test.ts`：集成用例 binDir 隔离（根因修复）+
  fixture 合法化 + 校验/备份/拦截新用例。
- daemon 心跳相关测试：触发边界/忙推迟/互斥用例（plan 阶段定位文件）。

## 不在范围内（显式清单）

- 不做坏 bundle 自动回退（.bak 自动重启）——人工兜底
- 不做新进程健康自证看护（对齐前作 Non-Goals）
- 不改 backend（recover API / sweep / 24h GC 全部复用现状）
- 不做常驻对账循环（方案 B 已否决）
- 不做 Windows 服务/计划任务等宿主看护形态
- 不覆盖 suspend-batch 优雅停止路径（boot 恢复已覆盖）

## 成功标准（可验证）

- 模拟心跳断 >720s 后恢复：本地有 suspended 记录时自动 recover，会话
  suspended → reconnecting → active，无需重启 daemon；断 <720s 不触发。
- 断连期间本地在跑 turn：恢复触发被推迟（busy pending），turn 完成后才恢复。
- 401/403 凭证断连 >720s 恢复后同样触发 recover。
- 下载内容 <64KB 或无 BUILD_ID：不落盘、不 respawn，旧进程保活。
- 替换前 target 存在时产生 `*.bak-<ts>`，同前缀保留最近 3 份。
- `_tryUpdate` stop 前校验拦截：不走 stop/respawn，所有权释放，盘修复后可重试。
- preflight.test.ts 全量跑完，真实 `~/.sillyhub/daemon/bin/` 文件 hash 不变。
- 既有全部相关测试（daemon-ci / 本地 vitest 相关文件）绿。
