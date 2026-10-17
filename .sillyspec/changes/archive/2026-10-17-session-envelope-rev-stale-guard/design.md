---
author: flow-machine-draft
created_at: 2026-10-17T13:14:59.532Z
---
# 设计记录（Design Record）— 2026-10-17-session-envelope-rev-stale-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

改 `frontend/src/stores/session.ts`：SessionState 新增单调 rev 计数器（持久化进信封）——setTokens/setUser/clear 三个用户驱动变更加一，storage 回放不自行加一而是采纳远端 rev；回放守卫先判 rev（远端更旧 = 迟到旧值，整体忽略），再走既有的差异比对（乒乓切断逻辑原样保留）。

选此方案依据：迟到旧信封覆盖新值的危害是「已登出/已续票标签页被幽灵复活」（2026-10-17-session-replay-pingpong-fix 评审 P3-3），窗口虽小但属刚出过 11 小时生产事故的同源子系统；rev 是最小充分方案——单调性天然定义「谁新谁旧」，不依赖时钟，不改 persist 中间件。旧形状信封无 rev 字段自动回落既有内容比对，混合版本标签页安全（新版代码的静默路径会饿死任何它参与的环）。

## 文件变更清单

- `frontend/src/stores/session.ts`（实现：rev 字段/三个变更加一/partialize/信封类型/回放守卫）
- `frontend/src/stores/session.test.ts`（测试：新增「session 信封 rev 防乱序」describe 7 用例）

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

`SessionState` 新增 `rev: number` 字段（初始 0，persist 落盘形状随之加 rev 键；旧 localStorage 无 rev 视为 0，persist version 不 bump）；`setTokens/setUser/clear` 行为变化：每次调用令 rev +1（对外签名不变，多一个可观测副作用）；`PersistedSessionEnvelope.state` 增加可选 rev。模块导出（useSession/SESSION_STORAGE_KEY/SessionUser/SessionTokens）不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：成立——这正是本变更的主目标。rev 严格旧的信封整体忽略，迟到不再覆盖新值；同 rev 信封按内容后到为准（与旧行为一致）。
2. 并发写：两标签同秒各自变更产生同 rev 分叉时，后到者按「等 rev 走内容比对」采纳，收敛到后写盘值；真实续票竞态仍由后端 60s grace 兜底（与旧行为一致）。
3. 切换/生命周期：安全。markHydrated 不加 rev（hydration 非用户驱动变更）；旧 localStorage（无 rev）hydrate 后 rev=0，新信封 rev≥1 均视为更新被采纳，无兼容断点。
4. 作用域：无新增串台面。rev 随 SESSION_STORAGE_KEY 单 key 信封走，比对只在该信封字段内。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：rev 分叉后同 rev 异内容互相覆盖出现「状态回摆」——分析后不成立：等 rev 内容比对必收敛到后写盘值，且真实 token 变更前总有一次网络往返（续票/登录），窗口内双写概率趋零；即便发生也是一次往返内自愈，非环。

放弃的方案：①用 Date.now() 时间戳做序——同机时钟看似可行，但测试确定性与「用户回拨系统时间」边缘不可控，计数器更简单；②在 persist 外再包自定义 storage 做写前去重——改动所有落盘路径，风险大于收益；③维持现状只记风险——幽灵复活虽罕见但后果（看似已登出实则持有撤销会话）难排查，趁 P3 记忆新鲜收口。
