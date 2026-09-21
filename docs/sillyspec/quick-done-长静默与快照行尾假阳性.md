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
