---
author: flow-machine-draft
created_at: 2026-10-13T10:43:40.961Z
---
# 设计记录（Design Record）— 2026-10-13-daemon-turn-anchor-snapshot

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

本变更是"轮次文件变化追踪"路线图（flow diff 之后）的第②步最小闭环：daemon 在 agent 每轮结束的干净边界（events.ts onResult，status 已收敛 active、currentRunId 已清）对会话 cwd 的 git 工作区打**内容锚点**——复制现场 index 为临时 index、`GIT_INDEX_FILE` 下 `git add -A`、`git write-tree` 得内容树 sha，同时记 HEAD sha；与该会话上一锚 `diff-tree -r --numstat` 得逐文件 additions/deletions，追加 JSONL 到 `<daemonStateDir>/.runtime/turn-anchors/<sessionId>.jsonl`。

选此锚形态依据评审四缺口定案：①untracked 必须覆盖（`git stash create` 不含未跟踪是雷，agent 主要产出是新文件，add -A 天然覆盖）；②复制现场 index 让 add -A 命中 stat 缓存（只有变化文件重新哈希，成本 ≈ 一次 git status，不是全仓重扫）；③tree sha 内容寻址天然去重（零变化轮不落盘）；④接线 fire-and-forget（模块内永不抛错），观测面不阻塞轮结果链路。diff 基线取上一锚（tree-to-tree 捕获轮间全部内容变化，含轮内 commit——Route B"真实"语义），首轮退 HEAD 树。后续切片（backend 落库 run_file_diffs、前端轮次行展示、A 轨工具事件归因对账）不在本变更。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

新增导出（`sillyhub-daemon/src/interactive/turn-anchor.ts`）：`recordTurnAnchor({cwd, sessionId, runId?, anchorsDir?}) → Promise<TurnAnchorRecord | null>`（永不抛错）、`defaultAnchorsDir()`、类型 `TurnAnchorRecord`/`TurnAnchorFileStat`。对外行为变化：interactive 会话每轮结束后 daemon 本地多一次 git 快照（best-effort，失败静默 null）；无网络/API/DB/前端面变化。events.ts onResult 增加 void 调用（3 行 + import），轮结果链路时序不变。

### 文件变更清单（自声明——注记带括号，兼作工具侧 declared-paren-strip 修复的端到端 dogfood 样本）

- sillyhub-daemon/src/interactive/turn-anchor.ts（交付：新模块，锚快照/diff/JSONL/串行链）
- sillyhub-daemon/src/interactive/session-manager/events.ts（交付：onResult 轮边界 void 接线 + import）
- sillyhub-daemon/tests/interactive/turn-anchor.test.ts（交付：真实临时 git 仓 7 用例）

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：成立——锚只看轮边界时刻的工作区内容快照，与事件顺序无关；迟到 result（session 已 ended/failed）在 onResult 头部早退不触发锚；轮内多次事件不影响（只在 result 边界打一次）。
2. 并发写：同 sessionId 经 per-session promise 链串行（prev 锚内存读写无竞态，前一环失败 .catch(()=>null) 不断链）；临时 index 文件名带 pid+uuid 不冲突；git 读操作不改工作区（add 只写临时 index）。不同会话互不阻塞。
3. 切换/生命周期：daemon 重启后内存 prev 锚丢失 → JSONL 尾行兜底恢复（坏行向前跳过）；临时 index 在 finally unlink（残留不挡后续，名字带随机段）；会话删除/结束无清理动作（JSONL 是 .runtime 观测数据，随 daemon 数据目录生命周期）。
4. 作用域：锚按 sessionId 分文件存储在 daemonStateDir()（SILLYHUB_DAEMON_DIR 隔离，测试注入 anchorsDir 不碰真实用户目录）；不跨工作区共享状态；git 操作以会话 cwd 为界（execFile 非 shell 防注入，路径参数无用户输入拼接）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：大仓上每轮 git add -A 的 IO 成本——mitigated by 复制现场 index（stat 缓存命中）+ tree sha 去重（零变化轮零落盘）；廉价门（本轮工具事件触过文件才打锚，评审 Gap4）留作后续切片，当前以去重+缓存先扛。次风险：首轮 diff 退 HEAD 树会漏掉"轮内已 commit"的归因（内容变化仍在 tree-to-tree 链上，仅首轮 files 口径偏小）——最小闭环已知边界，记档不扩。既有测试影响：onResult 接线在既有 session-manager 测试中对假 cwd（C:\work 等不存在路径）静默 null，实测 tests/interactive/ 1115 用例两轮全绿（首跑 1 例 pi-rpc 60ms 握手抖动，复跑+单跑均绿，与本改动无关）。

放弃的方案：①`git stash create` 打锚——不含 untracked（评审 Gap1 定性为雷，直接否决）；②每轮 commit 到 side ref——写引用有状态、并发清理复杂，write-tree 无引用纯内容寻址更干净；③`git status --porcelain` 轮询比对——无行级统计且 rename/untracked 口径碎；④锚存 DB（backend 落库）——本切片刻意 daemon-local（零 API 面），DB 化留给下一切片连同前端展示一起做。
