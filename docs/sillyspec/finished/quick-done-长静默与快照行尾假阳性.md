# quick --done 三坑：长静默疑似挂死 / 快照行尾 ruff 假阳性 / --status 误开新会话

**状态：活跃坑（待工具修复）｜发现于 2026-09-21（ql-20260921-005-d0aa 收尾时）**

## 现象

1. **--done 长静默疑似挂死**：step3 `--done` 在打印边界审计/L1 门警告后进入「门禁隔离快照」阶段（Temp/sillyspec-gate-*）实测 test+lint（本仓实测 841-1054s），期间**零进度输出**；若外层给 60-300s timeout 极易误判死锁杀进程（本会话连杀 3 次后才从 `--confirm` 探测到真实卡点是沙箱实测）。杀进程不丢进度（重跑 --done 续走），但每轮重建沙箱重跑实测，耗时成倍。
2. **快照行尾 ruff format 假阳性**：门禁 lint 在快照目录里报 `Would reformat: <本会话文件>`，回主仓跑 `ruff format --check .` 却 1294 files already formatted 全绿——快照 git checkout 行尾转换（CRLF/LF）与 ruff 格式偏好不一致，属环境假阳性而非真实 lint 债。
3. **`quick --status` 不带 `--change` 误开新会话**：查进度忘带 `--change` 时 CLI 不是查当前会话而是**新开一个空壳 quick 会话**（本会话误开 quick-d15f38a9，需 `--cancel` 清理；skill 文档有警告但 --status 语境下极易忘）。

## 根因

1. 沙箱实测无心跳/阶段提示，外层无法区分「在跑」与「死了」；
2. 快照 checkout 未固化行尾（或未带 `--renormalize` 类口径），ruff 以字节级比对；
3. `--status` 与 `run quick` 共用入口，缺省语义是「新建」而非「查看最近」。

## 护栏 / 绕过

- --done 一律后台跑 + ≥15 分钟容忍；用 `--confirm` 先探测审计面是否可达；
- 快照 lint 红先回主仓对照同命令，主仓绿即环境假阳性，随 `SILLYSPEC_QUICK_TEST_GATE=skip`（或仅 test skip、lint 复核后）留痕收尾；
- 查进度永远带 `--change <sessionId>`；误开的空壳立即 `--cancel`；
- **commit 前必看 `git diff --cached --stat` 核对暂存面**：共享仓初始 index 可能残留他者会话已 add 未提交的文件（本会话实证——显式 pathspec `git add` 只保证"加了我的"，不保证"暂存区只有我的"；夹带后用 `reset --soft HEAD~1` + 差集 `restore --staged` 修正，注意 `core.quotepath=off` 取清单防中文路径转义）。

## 证据

- 三轮杀进程记录与 `--confirm` 概览：`/tmp/ql-done*.log`（本会话）；沙箱实测 841.9s passed 与第二轮 1054.3s scan_docs 污染 BLOCK 同批输出；
- 主仓 `ruff format --check .` 1294 全绿 vs 快照 4 文件 Would reformat 对照；
- quick-d15f38a9 误开 + cancel 输出（ql-20260921-007-727c 已取消条目）。

## 处置记录（2026-09-22 定时收口：坑2/坑3 已修，坑1 留专项）

- **坑 3（--status 误开新会话）已修复**：`run quick --status` 不带 --change 时不再新建——读 current-quick-run-id marker（缺则按 guard.json mtime 取最近会话）展示其状态 + 提示带 --change；无任何近期会话则零副作用 exit 0。手动实证：空仓引导退出不建会话；有会话时直接展示进度面。
- **坑 2（快照行尾 ruff 假阳性）已修复（主仓对照复核机制化）**：quick 门禁 lint 在快照失败且归属本会话（非存量债）时，主仓同命令复跑——**主仓绿 = 环境假阳性 advisory 放行**（本会话文件在真实工作区格式合规，行尾转换类差异不再拦完成）；主仓也红 = 真实格式债维持硬拦。坑文档的人工绕过（回主仓对照）成为自动行为。
- **坑 1（沙箱实测长静默）留专项**：需把 spawnSync 改异步 + 心跳输出（30-60s 一条「实测进行中 Ns」），涉 quick-audit 门禁执行器的并发模型改造——非巡检级小修。现有护栏（后台跑 + ≥15min 容忍 + --confirm 探测）继续有效。
- 回归：quick-audit / verify-postcheck / module-subset 相关 30 用例全绿。**本文件保持活跃（坑 1 余项）**。

## 处置进展补记（2026-09-23 定时收口：坑1 预告版落地，文件归档）

- **坑 1（长静默）以「实测预告」最小版收口**：quick 门禁实测启动前打一行预告——「大仓全量可达 15-20 分钟，期间无输出属正常；后台跑 + ≥20 分钟容忍，勿按超时杀进程（杀掉不丢进度但每轮重建沙箱耗时成倍）」+ 是否隔离快照标注。消除「零信息误判」主因（外层不知道在跑 vs 死了）；真异步心跳（30-60s 周期输出）仍需 spawnSync→spawn 改造，作为增强项留 backlog，不再阻塞本文件。
- 三坑全部有着落（坑2 主仓对照复核 / 坑3 --status 防误开 / 坑1 预告版），**归档**。
