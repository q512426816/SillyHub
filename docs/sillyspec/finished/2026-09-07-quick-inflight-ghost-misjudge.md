# 进行中 quick 会话行被 ghost 判定误报（清理后「又长出来」）

- 创建：2026-09-07（sillyhuber，变更中心「一键清理 ghost」清完又现残留实测）
- 状态：已修复（2026-09-07，sillyspec 仓 ql-20260907-002-b9d4 / commit 3690b41：stage-machine overview/show 与 doctor-diagnostics D4 同源豁免 quick 会话行，cleanup-ghosts 保留 quick 行归档兜底；全量 359/0 + lint + docs check 550/550 验证）
- 涉及版本：sillyspec 3.28.0（nvm4w 全局安装）

## 现象

变更中心（数据源机器 DESKTOP-HJ0AM09）点「一键清理 ghost」返回成功，但 ghost 很快又出现
1 条，观感是「清不掉」。daemon 日志实证两次清理均 `state=success exit_code=0`
（2026-09-07T01:55:04Z / 02:05:42Z），且当时在场的旧 ghost（quick-066cb000）确实被归档。

新出现的 ghost 是清理**之后**才启动的 quick 任务（quick-394f323e，ql-20260907-006-2972）：
10:11 启动，从写库那一刻起就满足 ghost 判定。它的 QUICKLOG 条目已翻「已完成」，但 DB 行
仍是 active（quick `--done` 收尾链在「QUICKLOG 翻状态」之后、「注销 changes 行」之间中断），
因此不会自行消失。

## 根因（工具侧两处设计相互冲突）

1. `progress.js initChange` 对 `quick-[0-9a-f]{8}` 会话行**特意不建** `changes/<名>/`
   目录（注释明示「进度存 SQL 不需要实体 change 目录——跳过避免空目录残留」）。
2. ghost 判定（`progress/stage-machine.js overview` 与 `doctor-diagnostics.js`
   ghostRows）= 「DB `status='active'` 且 changes/ 无该目录」，**未排除 quick 会话行**。

两条相加 → 所有进行中的 quick 任务天然命中 ghost；quick `--done` 正常收尾会
`unregisterChange` 翻 archived（ghost 随之消失，所以平时不易察觉），但：

- quick 进行中（数分钟窗口）→ 面板短暂误报 ghost；
- quick 收尾链中断（QUICKLOG 已完成、DB 行未注销）→ 持久 ghost。

时序巧合时（quick 密集启动）用户看到的就是「清了又长」，实际每次清理都成功。

## 建议修法（sillyspec 工具侧）

- ghost 判定处排除 quick 会话行（`/^quick-[0-9a-f]{8}$/`，与 run/command.js sessionId
  守卫同形正则；或按 `quicklog_id` 非空判），`stage-machine.overview` 与
  `doctor-diagnostics` 两处同源修，避免面板误报。
- `doctor --cleanup-ghosts --confirm` 对「QUICKLOG 已完成但 DB 行仍 active」的 quick
  会话行保留归档能力（收尾中断的兜底出口，本次实测有效）。

## 临时绕过（面板侧用户操作）

- 看到单条 quick-xxx 的 ghost 且「最近活跃」就在几分钟内 → 大概率是进行中的 quick，
  等它跑完自行归档，不用反复点清理。
- 「最近活跃」已停止增长且 QUICKLOG 已标完成 → 再点一次「一键清理 ghost」即可归档
  （本例 quick-394f323e 即此形态）。
