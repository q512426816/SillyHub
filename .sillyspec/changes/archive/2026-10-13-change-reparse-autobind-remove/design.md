---
author: flow-machine-draft
created_at: 2026-10-13T15:10:14.439Z
---
# 设计记录（Design Record）— 2026-10-13-change-reparse-autobind-remove

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

移除 `ChangeService.reparse` created 分支对 `_bind_change_to_session` 的调用，并整体删除该方法（2026-08-14-change-center-conversation-driven task-02 / design §8 D-007 引入的启发式绑定）。绑定语义收敛为「命令解析通道唯一」：只有会话内实际执行 `sillyspec run/flow --change <名>` 命令（run_sync 命令解析与 daemon agent-logs 上报两分支，`change/binding.py`）才写 change_session_links。

选这个方案的理由：D-007 假设「新变更出现时，最近活跃会话即干活会话」，实测误伤面大——2026-10-13 阿里云实例：归档目录随镜像同步首次到达触发 reparse 建行（变更 2026-10-13-slim-subagent-false-running），自动绑上 43 分钟前活跃的「你好」闲聊会话（link 与变更行创建同事务、仅差 13ms，已查实）。而真正干活的会话本就会经命令解析通道精确绑定，D-007 只是补充猜测，删除后无损覆盖。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外 API/端点/表结构变化。`ChangeService` 删除私有方法 `_bind_change_to_session`（私有面，全仓仅 reparse 一处调用，无外部消费方）；`reparse` 返回值 stats 语义不变（created 计数照旧）；change_session_links 表结构、既有 link 行与创建时绑定（daemon create.py change_id 落 link）、@ 联想绑定、quicklog 绑定通道全部不动。测试面：test_change_session_binding.py 整体重写为新行为断言（含已删方法防复活守卫）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   成立。命令解析通道（agent-logs 上报）可能晚于 reparse 建行到达，但 `bind_session_to_change` 对已存在的 Change 行只补 link 不建占位行，迟到绑定照常落库——该顺序无关性与移除前一致（D-007 本就不参与此竞态的正确性，只是建行时刻的一次性猜测）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   删除的是 reparse 事务内「读最近会话 + 写 link」动作；移除后 created 分支只剩建行（原有唯一键 savepoint 兜底不变），并发面净减不减增。既有命令通道绑定自带 savepoint + unique(change_id, session_id) 兜底，不受本变更影响。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   安全。reparse 中途中断时变更行落库事务语义不变；会话侧本变更零改动，无新增生命周期状态。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   不会。D-007 本身按 workspace 隔离（误绑也只发生在工作区内）；移除后绑定只由命令通道产生，天然按命令中的 `--change` 名归属到对应 Change 行，不存在跨工作区串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：纯本地开发（未走平台会话）产生的新变更不再有任何自动会话关联线索。判定为可接受损失——该场景下平台侧本就没有干活会话，绑「最近活跃」只是错误猜测（本变更的起因即其误伤实例）；真需要回溯时仍有命令通道与人工 @ 绑定可用。

试过但放弃的方案：
- 收紧筛选条件（只绑「跑过任意 sillyspec 命令的最近会话」）——仍是猜测式归因，无法区分跑的是别的变更的命令，语义依旧错误。
- reparse 建行时按日志检索「含 `--change <本变更名>` 命令的会话」再绑——该能力命令解析通道已有（extract_spec_bindings 逐段精确解析且天然幂等），重复实现无增益，故整体删除。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| M | backend/app/modules/change/service.py | 删 reparse created 调用点 + `_bind_change_to_session` 方法；reparse docstring 去 D-007 表述 |
| M | backend/app/modules/change/model.py | ChangeSessionLink 模型注释去「自动绑定最近活跃会话」表述 |
| M | backend/app/modules/change/binding.py | 模块 docstring 中对 `_bind_change_to_session` 的风格引用改写 |
| M | backend/app/modules/change/tests/test_change_session_binding.py | 整体重写为新行为断言 + 已删方法防复活守卫 |
| M | backend/app/modules/change/tests/test_spec_binding.py | docstring 旧引用文案修正（测试逻辑零改动） |
| M | .sillyspec/docs/backend/modules/change.md | reparse 关键逻辑段改「created 不产生会话绑定」 |
| M | .sillyspec/docs/backend/modules/_module-map.yaml | reparse 符号注释同步 |
| M | .sillyspec/docs/SillyHub/modules/change.md | 同代码另一项目视图：会话绑定段同步零自动绑定口径（清单补登，初版漏列） |

## 披露：并行变更带入（评审 P1 补救记录）

task-01 提交 3cab26f0d 以整文件 pathspec `git add service.py` 暂存时，并行活跃变更
2026-10-13-change-owner-backfill 正在编辑同一文件的工作区，其 owner_id 两处 hunk
（reparse created 分支传 `owner_id=workspace.created_by`、`_build_change` 增
`owner_id` 参数）被一并带入提交。该行为改动**不属于本变更**任何 FR/design 裁决；
归属已双侧确认——对侧变更提交 e3c98db92 消息自述「service.py 改动已随并行变更
提交 3cab26f0d 带入」。revert 本变更时应只回退 D-007 移除相关 hunk，owner_id
改动按对侧变更的收口面处置。

## 运维备注：存量误绑 link 行不自动清理（评审 P3 处置指引）

本变更只停新增自动绑定，不回溯清理既有 change_session_links。已知误绑实例：阿里云
生产库变更 2026-10-13-slim-subagent-false-running ↔ 会话 af6b1894（「你好」闲聊
会话）的 link 行 359df40a——收口后人工删除该行即可，属展示层关联修正、无级联影响。
