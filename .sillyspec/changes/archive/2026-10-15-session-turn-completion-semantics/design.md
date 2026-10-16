---
author: flow-machine-draft
created_at: 2026-10-16T00:58:34.017Z
---
# 设计记录（Design Record）— 2026-10-15-session-turn-completion-semantics

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

上一变更把绿点/完成通知锚定在会话终态 ended，但平台里一轮任务跑完后会话仍是 active（只有手动结束才 ended），用户在阿里云部署实测「跑完无绿点无通知」。本变更把「执行完成」改为轮次级口径（用户确认）：活性 working/blocked→idle 转移即一轮执行结束。实现上把完成通知存储抽为单一源 `lib/session-completed-unread.ts`（一键一角标），use-session-liveness 的转移检测改写完成标记（取代原红色「空闲未读」——两者本就是同一时刻同一事件的两种颜色，合并后语义唯一），并新增 suppress 谓词（正选中该会话不标记，与面板终态来源判等口径一致）；面板 sessionStatusIndicator 增补「活性 idle + 完成标记 → 绿点」分支（点击进入后随角标一并消失回归留白），红色未读管线整体退役。

改四个文件：新 lib、use-session-liveness.ts（标记语义 + suppress）、session-list-panel.tsx（去 livenessUnread 管线 + 判定分支）、两测试文件重写对应断言。后端与 API 契约零变化。

### 文件变更清单（本变更交付对账面）

| 文件 | 变化 |
| --- | --- |
| frontend/src/lib/session-completed-unread.ts | 新增（完成通知存储单一源，自面板迁出） |
| frontend/src/hooks/use-session-liveness.ts | 修改（转移检测改写完成键；移除 isUnread/clearUnread 导出；新增 suppress 谓词） |
| frontend/src/hooks/__tests__/use-session-liveness.test.ts | 修改（断言改完成键 + suppress 用例） |
| frontend/src/components/sessions/session-list-panel.tsx | 修改（去 livenessUnread 管线；判定增 idle+完成标记→绿点；红角标退役） |
| frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | 修改（矩阵增轮次完成用例；红色未读 describe 重写为轮次完成绿角标） |

工作区其余在途文件（docs/sillyspec/ → finished/ 的缺陷记录搬移等）属并行会话在途工作，不在本变更交付面。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增 `frontend/src/lib/session-completed-unread.ts`：导出 `isCompletedUnread/markCompletedUnread/clearCompletedUnread`（键 `sillyhub:session-completed-unread:<id>`，从面板迁出，实现不变）。
- `use-session-liveness.ts`：**移除导出** `isUnread/clearUnread`（红色未读退役，仓库内唯一消费方 session-list-panel 同变更内迁走）；`useSessionLiveness` opts 新增可选 `suppress?: (sessionId) => boolean`；转移检测由写 `sillyhub:liveness-unread:` 改写完成键（prevState 持久化键 `sillyhub:liveness-state:` 不变）。
- `session-list-panel.tsx`：`sessionStatusIndicator` 增第三参 `completedUnread`（活性 idle + 标记 → 绿点「执行完成」）；`SessionRow` props 移除 `livenessUnread`、`completedUnread` 语义扩为两来源共键；`SessionStatusSlot` 移除红色角标。
- 对外（跨模块）行为变化仅 UI 标识层；后端端点/OpenAPI 无改动，无 gen:types 义务。旧 `sillyhub:liveness-unread:*` 键不再读写（存量键自然废弃，不清理——无碰撞面）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：活性 map 与会话列表独立轮询，转移到达顺序不定——轮次完成只依赖 hook 自己的 prevState 链（`sillyhub:liveness-state:`），与会话状态链（prevStatusRef）互不依赖；两来源写同键，谁先到谁点亮，幂等无冲突。working→working 心跳重推不触发（值不变不写转移）。
2. 并发写：仍是单浏览器 localStorage 存在性键，多标签并发 mark/clear 仅角标亮灭展示差异；两来源同写一键最坏重复 setItem（幂等）。
3. 切换/生命周期：suppress 谓词按当轮 selectedSessionId 判定——用户在会话上看完收尾则不标（错过即不补，与上一变更口径一致）；prevState 持久化跨刷新保留，完成标记落盘保留至点击；已读后 idle 回归留白，无时间阈值介入。
4. 作用域：键按 sessionId 全局唯一，跨四种 scope 共享（与上一变更同策略）；hook 为多挂载共享缓存（固定 all 槽），标记逻辑在 hook 内单处执行，多挂载不重复写（值幂等）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：轮次完成依赖活性数据链（daemon 自发现日志 → tailer 推导 → 推送落库 → 前端 30s 轮询），链路断则「跑完无绿点无通知」依旧——用户阿里云实测正是此现象，属部署/数据面问题，本变更不解决链路本身（已在交付说明给服务器排查清单：工作台总览卡有无活性行 → 判别上报链断 vs 关联断）。放弃的方案：a) 给 idle 设时间窗（如 N 小时内算「刚完成」）——引入魔法数且窗口内重复渲染绿点语义含混，改用点击清除的确定性语义；b) 保留红角标只加绿角标——同一行两枚角标且语义重叠（「回来看看」vs「执行完成」是同一事件），用户明确要绿色完成语义；c) 把完成检测全收进面板（连活性转移也面板算）——面板需自维护活性 prevState 副本，与 hook 的 prevState 键双源漂移，不如 hook 单处检测。
