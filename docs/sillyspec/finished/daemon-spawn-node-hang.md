# daemon 进程内 spawn node 子进程挂起（sillyspec_status 采集恒失败）

- author: qinyi
- created_at: 2026-09-07 23:40:00
- 关联变更: 2026-09-07-conflict-diff-compare（验收期发现；非该变更引入）

## 现象

daemon（`~/.sillyhub/daemon/bin/sillyhub-daemon.js` 单文件 bundle）长驻进程内
`execFile(process.execPath, [sillyspec-bin, 'progress', 'show', '--json'], {cwd: 主仓根, timeout: 30000, windowsHide: true, env: {SILLYSPEC_SYNC_TIMEOUT_MS: 20000, ...process.env}})`
（`runProgressJsonDefault`，sillyspec-manager.ts）恒失败：

- 大多数拍 `sillyspec_status_collect_timeout timeout_ms=30000`（子进程挂满 30s 被 kill）
- 伴随 `nonzero_exit exit_code=3221225794`（0xC0000142 STATUS_DLL_INIT_FAILED，kill 树后的退出码形态）

后果：`_statusKnown` 恒 false → 心跳不带 `sillyspec_status` 键 → backend 两态语义
（键缺席=置 NULL 清除）→ 机器视图冲突清单恒空 → 变更中心「平台同步」卡与工作区总览卡
不渲染冲突行；conflictSnapshot 的 progress 分支同样 spawn 失败（progress=null 容忍降级）。
**spec-tree 分支不受影响**（读文件不走 spawn，compare 端点 183 文件秒回实证）。

## 已排除（独立进程复现矩阵，全部成功 130-300ms）

- git-bash 直跑 / nohup / PowerShell Start-Process Hidden / wscript vbs（cmd /c）各种进程链起的外层进程
- 同参数（cwd/timeout/windowsHide/env 含 SILLYSPEC_SYNC_TIMEOUT_MS 注入）execFile
- 三并发同时 spawn
- node -e 字符串转义污染误报已排除（文件形态干净复现）

即：**同一台机器、同一命令、同一 spawn 选项，独立进程全部成功，daemon 进程内恒挂起**。

## 未排除 / 下一步排查方向

1. daemon 长驻进程状态差异：WS 长连接、liveness tailer 常驻子进程、会话子进程生态、
   定时器——怀疑某个句柄/资源被子进程继承后初始化失败（STATUS_DLL_INIT_FAILED 语义）。
   建议：挂起发生时对子进程 node.exe 抓 dump（procdump）或 ETW 跟踪 loader。
2. 对照实验：mini 长驻脚本（60s 定时 spawn，vbs 起）是否复现——若复现即最小可复现；
   不复现则差异在 daemon 本体（可用二分法砍 daemon 模块）。
3. 环境矩阵：换一台机器/干净用户目录装 daemon 验证是否本机特有。
4. 临时缓解评估：`SILLYSPEC_BIN` 指向包装器（需 execFile 可执行形态）或采集降级路径。

## 历史佐证

机器 68c63051 的 sillyspec_status 历史数据（6 条冲突）来自早前会话落库；本机 daemon
自 2026-09-04 起的多代进程（bash/e2e-dummy/正式 key）均未观察到采集成功拍。

## 影响面

- sillyspec_status 采集（09-02 变更建的链路）在本机不可用——平台同步卡/总览卡冲突区无数据源。
- 本变更（conflict-diff-compare）的 compare 端点 spec-tree 弹窗不受影响（不 spawn）；
  progress 弹窗本地侧数据受影响（降级「—」占位）。

## 巡检注记（2026-09-08 定时扫描）

- 定性确认：环境级疑难（daemon 长驻进程内 spawn node 恒挂起 + STATUS_DLL_INIT_FAILED，独立进程不复现）——修复需活体诊断（文件「下一步排查方向」的 procdump/ETW 抓 loader、mini 长驻脚本对照实验、换机矩阵），超出定时巡检的盲改能力，本轮不动代码。
- 影响面重申：仅 sillyspec_status 采集链路（spec-tree 分支不受影响，读文件不 spawn）；临时缓解路径（SILLYSPEC_BIN 包装器/采集降级）待原作者评估。
- 保持活跃，等待活体排查进展；若后续确认某代 daemon 修复（如自更新后采集恢复），可凭 sillyspec_status 历史拍点验证后归档。
