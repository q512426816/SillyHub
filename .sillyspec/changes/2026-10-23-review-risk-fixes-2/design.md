---
author: flow-machine-draft
created_at: 2026-10-22T23:55:20.073Z
---
# 设计记录（Design Record）— 2026-10-23-review-risk-fixes-2

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

四处独立小修，均为 2026-10-23 只读审查的遗留发现，互不依赖：

1. **sillyhub-daemon 探针淘汰竞态**（`sillyspec-manager.ts`）：`_evictedCwds` 由 `Set<rootPath>` 改 `Map<rootPath, 被淘汰 workspaceId>`——skip 判定从「裸根封禁」收紧为「根+工作区双键命中」，陈旧探针在重 claim 之后落地的淘汰条目只封发起淘汰的旧工作区，同根新 wsId 照常采集（不再永久静默停摆）；skip 命中加一次性 warn（镜像既有 `_crossrepoSkipLogged` 先例），`clearStatusProbeEviction` 同步清 warn 标记。daemon.ts 侧守卫（2356 行异根判断）无需改动。
2. **跑马灯 rAF 空转**（`turn-live-marquee.tsx`）：滚动循环改 `ensureScroll`/`stopScroll` 双入口——`step` 只在仍在追（distance>0.5）时续排下一帧，追平即停排置空 rafRef；`applyTarget`（entries 变化 / ResizeObserver 的唯一目标更新入口）尾部与「恢复可见」处调 `ensureScroll` 重启。不可见暂停、reduced-motion 静态、卸载清理语义全保留。
3. **文件快照 diff 阶段吞错**（`turn-file-changes.ts` + `turn-file-changes-types.ts` + `session-manager.ts`）：`CollectTurnFileChangesInput` 新增可选 `onGitDiagnostic` 回调，diff 两阶段 catch 的非 timeout 分支回调 `{stage, reason, message}`；session-manager 接线 `console.warn('[session-manager] turn_file_changes_git_degraded', …)`（该文件既有日志约定）。快照契约零变化——`TurnFileChangesReason` 是 types 注释明令**冻结的固定枚举（禁新增值，错误按事件命名）**，故错误走日志而非快照 reason。
4. **翻译前端脏响应体悬挂**（`thinking-translate.ts`）：`requestBatch` 把 fetch 后的响应处理（engine_ready 判定/items 解构/回填）并入 try 域——2xx 脏响应体（safeJsonParse 得 null / items 缺失）的 TypeError 按「网络失败同款降级」处理（本批回退原文 + 60s 退避），Promise 必 settle，`inflight` Map 不再泄漏。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `sillyspec-manager.ts`：私有字段 `_evictedCwds` 类型 Set→Map、新增私有 `_evictedSkipLogged`；`clearStatusProbeEviction(rootPath)` 公开签名不变（行为增：清一次性 warn 标记）；新增日志事件 `sillyspec_status_skip_evicted`（warn）。
- `turn-live-marquee.tsx`：组件 props 零变化；内部 rAF 生命周期重构（对 DOM/视觉行为无可见变化，仅消除追平后的空转帧）。
- `turn-file-changes-types.ts`：`CollectTurnFileChangesInput` 新增可选字段 `onGitDiagnostic?: (d: {stage: 'name-status' | 'numstat'; reason: TurnFileChangesReason | null; message: string}) => void`（缺省不传=行为与旧版一致）；快照/上报/枚举零变化。
- `session-manager.ts`：`_startTurnFileChangesCollection` 调用处传诊断回调；新增 `console.warn` 事件 `turn_file_changes_git_degraded`。
- `thinking-translate.ts`：`requestBatch` 内部 try 域扩围；导出面无变化；HTTP 端点/请求体无变化。
- 后端/daemon 协议、schema、迁移：无。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   修复 1 处理的正是迟到写：陈旧探针的淘汰落地于重 claim 清表之后——Map 双键使迟到条目只影响旧 wsId；新 wsId 采集照常（若项目侧仍缺库，会按自己的连败计数重新淘汰，语义自愈）。修复 2 中 target 更新与重启无竞态：`applyTarget` 先写 targetRef 再同步调 ensureScroll，同一事件循环内完成。修复 3 的回调在 catch 内同步发出，先于快照返回，无乱序面。修复 4 的降级路径统一走 `failEntries`（内部 `fillEntry` 有重复回填防御，幂等）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   修复 1 的 Map/`_dbMissingStreaks` 仅由采集循环单执行体读写（与旧 Set 同一无锁假设）；daemon 回调只读自身映射表。修复 2 的 rafRef 在单线程事件循环内读写（rAF 回调与 React 事件同队列）。修复 3 回调同步、无共享态。修复 4 全在模块单例事件循环内。均无新增并发面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   修复 2：组件卸载 effect cleanup 调 stopScroll（cancelAnimationFrame + rafRef 置空）；不可见（visible=false）暂停、恢复重启——既有 FR-06 语义保持；reduced-motion 下 ensureScroll no-op。修复 1：Map 条目生命周期与旧 Set 一致（同名重 claim 清除；永不重建的根条目常驻，量级为路径字符串——审查已判定可接受，本变更不扩题）。修复 3/4：无新生命周期面。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   修复 1 把「根」级封禁收窄为「根+工作区」级——跨工作区误伤正是本修复目标；daemon 多实例各自持进程内表，无跨实例面。修复 2/3/4 均组件/调用局部，无作用域面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：修复 1 的键控放宽使「同根换 wsId 重建但项目侧仍缺库」形态多付 3 拍探测（约 90s）才重新淘汰——对比旧形态的「永久静默停摆」，属可接受的有限成本。修复 2 的风险是重启链路遗漏（target 更新但未重启滚动）——`applyTarget` 是 target 更新的唯一入口，ensureScroll 挂其尾部即全覆盖，可见性恢复另有点位。修复 3 的回调是可选参数，漏传即静默（与旧一致），由 session-manager 唯一生产调用点接线兜住。修复 4 的退避策略对脏体与网络失败一视同仁——单次脏体触发 60s 退避略保守，但防风暴优先（与 engine_ready=false 同款口径）。

放弃的方案：①在 daemon.ts evict 回调里二次核对映射再放行——放弃，治标不治本：skip 表仍在 manager 侧裸根键控，legacy 单槽位路径不经过回调，竞态窗口仍在；②给 `TurnFileChangesReason` 加 `git_error` 枚举值——放弃，types 注释明令「固定枚举，禁止新增值——错误按事件命名，不造无依据枚举」，加值违反模块自身设计契约且牵动前端 reason 映射；③修复 2 用「追平后降频轮询（如 1fps 续排）」——放弃，仍是空转只是变慢，且引入与速度常量耦合的第二节拍；④修复 4 只兜 null 不退避——放弃，脏体通常意味着代理/网关异常，不退避会对异常源形成请求风暴。
