---
author: flow-machine-draft
created_at: 2026-10-19T23:53:09.722Z
---
# 设计记录（Design Record）— 2026-10-20-backfill-dryrun-log-scrub

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

落地 2026-10-20 24 小时风险审查的两条高置信中危处置。① `scripts/backfill_commit_type.py` 参数面翻方向：opt-in 的 `--dry-run` 改为缺省 dry-run + `--apply` 落盘开关 + `--apply` 必须带 `--yes` 确认门（本脚本每次运行都是全仓扫描写、无更窄定向面，故门作用于 `--apply` 本身）——与同仓 `backend/scripts/backfill_change_titles.py` 既有口径逐项对齐，消除"两个回填脚本缺省方向相反"的误用陷阱；`write_commit_type` 写入逻辑（原位替换/追加/新建、CRLF 保留、幂等）一行不动。② `sillyhub-daemon/src/interactive/zcode-app-server-driver.ts` 移除 :183-185 真机诊断 spawn 参数 `console.log`（cmd/args/cwd 明文未脱敏）；相邻 :187 env 键日志值已走 `redactEnvValueForLog` 脱敏且对 provider 路由排障有持续价值，保留。纯日志删除，无行为变化。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `scripts/backfill_commit_type.py` CLI 契约变化（唯一对外面）：裸跑 → dry-run（原为落盘），输出行前缀 `[dry] `；`--dry-run` 旗标移除（缺省即是）；新增 `--apply` 落盘开关，不带 `--yes` 时 stderr 报错退出码 2；`--apply --yes` 等价于改动前裸跑落盘（写入路径零改动）。
- zcode 驱动：无接口/协议/类型变化——仅删除两行 console 输出（其一为 eslint-disable 注释）；API 端点、RPC、配置面均无触碰。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。脚本是一次性 CLI 顺序执行、无事件输入，参数门只在 `main()` 入口判一次；日志删除不涉及任何顺序假设。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   脚本本身仍非并发安全（两个 `--apply` 同时跑同一目录可能交错写 flow-state.yaml）——改动前既有属性，本变更通过缺省 dry-run 显著降低误触发概率，不新增并发面（一次性运维脚本按既有约定单实例执行）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全性提升：裸跑/误跑不再产生任何写入（缺省 dry-run）；`--apply --yes` 中断与改动前同语义——单文件写回由单次 `open("w")` 承担，未改动。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。脚本作用域仍限本仓 `.sillyspec/changes/`（repo_root 由脚本位置推导）；sandbox 验证在 `.tmp/` 独立副本内进行，不触主仓；日志删除无作用域面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：已习惯旧口径（裸跑即写）的使用者肌肉记忆被翻转——首次 `--apply` 忘带 `--yes` 得到退出码 2。缓解：docstring 用法段与 `--yes` 报错信息都给出明确指引；且 261a33367 提交信息记载本仓已回填完毕（复跑应全 unchanged），日常无人需要再跑 `--apply`。

试过但放弃的方案：① 交互式确认提示（裸跑问 y/N）——破坏可脚本化性，CI/批处理无法应答，flag 门（`--yes`）是 backfill_change_titles.py 已验证先例；② 连同 :187 env 键日志一并删除——该行已脱敏且承载 provider 路由排障信息，删除超出审查发现的事实面。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| M | scripts/backfill_commit_type.py | 参数面翻方向：缺省 dry-run + `--apply`/`--yes` 确认门 + docstring 用法同步 |
| M | sillyhub-daemon/src/interactive/zcode-app-server-driver.ts | 移除 :183-185 真机诊断 spawn 参数明文日志（保留 :187 脱敏 env 键日志） |
