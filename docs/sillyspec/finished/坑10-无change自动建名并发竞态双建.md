# 坑10：sillyspec 无 --change 自动建名并发竞态——双进程同过检查各建一行

> 发现于 2026-10-13（事故 2026-10-13-new-change-e5a27813 的源头，本仓 multi-agent-platform）。
> 状态：已修复（sillyspec 仓变更 2026-10-13-autocreate-atomic-claim，归档于该仓 .sillyspec/changes/archive/）。

## 现象

16:25:33 同一秒内出现两个新变更：`2026-10-13-daemon-log-config-view`（合法）与 `2026-10-13-new-change-e5a27813`（自动命名垃圾）——后者即坑9 幽灵变更的来源。

## 根因

`run brainstorm` / `run auto` 无 `--change` 时的自动建名是两步：`pm.listChanges` 查零活跃 → `pm.initChange` 插行。检查与插入之间无原子性——两条并行 sillyspec 进程（一条带 --change 显式建、一条裸跑自动建）在对方提交前都读到"零活跃"，各自通过检查各建一行。autoName 是 `日期-new-change-随机4字节hex`（run/command.js），撞出的随机名无人认领即成垃圾。

## 修复（sillyspec 仓 2026-10-13-autocreate-atomic-claim）

- `ProgressManager.initChangeIfNoActive`：单条 `INSERT INTO changes ... SELECT ... WHERE NOT EXISTS(active 行) AND NOT EXISTS(同名行)` 原子抢占——SQLite 单语句原子；跨进程 WAL 快照过期（BUSY_SNAPSHOT）由 db.js transaction 封装 BUSY 整体重跑收敛，重跑后守卫见先行者已提交行即拒绝（恰一创建）。
- 败者零残留：目录创建移到抢占成功之后（败者不留 changes/<自动名>/ 空目录、零 DB 行）。
- run/command.js 两处调用点换原子抢占，失败复用既有 exit 2 多活跃引导；顺带清掉 run auto 旧 `>1` 死宽限（单活跃由上游 pm.read 自动定位，本就不进该分支，行为零差异）。
- `initChange`（显式 --change / 平台工具 / 测试 fixture）本体不动。
- 测试锚：sillyspec 仓 test/init-change-if-no-active.test.mjs（5 例），独立评审 PASS（blob hash 级核对冻结件与工作树一致）。

## 验证要点

- 多活跃仓裸跑 `run brainstorm --input ...` → exit 2 列出活跃变更，不产生 new-change 行。
- 全局 sillyspec 是源码仓 junction，修复对后续 CLI 调用即时生效，daemon 无需重启。
