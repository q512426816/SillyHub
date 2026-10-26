---
author: flow-machine-draft
created_at: 2026-10-26T15:08:59.742Z
---
# 设计记录（Design Record）— 2026-10-26-ci-red-to-green

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

CI 四条 workflow 三红一疑卡，根因四类、修法各对位：

1. **e2e-ci（红）**：`.github/workflows/e2e-ci.yml:24` PG service 用 `postgres:16-alpine`，缺 vector 扩展，迁移 20261015200000 fail-closed 中止。修法：镜像换 `pgvector/pgvector:pg16`（对齐 deploy/docker-compose.yml 既有口径，迁移报错信息与 2026-10-15-knowledge-search-pgvector design Phase 4 均指名此修法）。一行配置，数据卷不涉及（CI 每次全新 service 容器）。
2. **daemon-ci（红，11 用例）**：三类根因——
   - `reportTurnPhase`（daemon.ts:9496，2026-10-26-session-stage-progress 引入）直接 `this._client.notifyTurnPhase(...)` 后挂 `.catch`，但**方法缺失时属性访问同步抛 TypeError**，`.catch` 尚未挂上即外溢，中断 `_startInteractiveSession` 创建链（spec_sync 阶段在 create 之前）→ thinking-level 4 用例 waitForSpy 超时 + spec-sync B 组 5 用例 spy 0 调用。修法：源码加固——上报体包 try/catch 吞同步异常（兑现该函数自己注释声明的 D-009「上报失败仅 debug 不阻塞」不变量）；onTurnMessage 桥拦截分支（daemon.ts:4883 附近）同样核验防护。
   - `turn_phase_report` 旁路消息（session-manager/events.ts:283，每个 envelope 无状态直发、去重键在 daemon 层拦截分支 D-013④）在单测里直击 `deps.onTurnMessage` mock，穿过了 task-lifecycle 只滤 `session_header` 的过滤断言（期望 3 得 7；期望 0 得 1）。修法：测试断言收窄排除 `type==='turn_phase_report'`——同文件 2026-10-25-trajectory-source-model 对 session_header 旁路的收窄先例逐字同构，TASK 流断言主体不动。
   - mock 工厂漂移：spec-sync 测试 vi.mock 工厂只列 4 个导出，daemon.ts 现导入 7 个（heartbeat 用 `readLocalSpecVersion` 缺失→heartbeat_failed 噪音）。修法：工厂改 importOriginal 展开真实模块再覆盖 4 个 spy（对未来新增导出零漂移）；client mock 补 `notifyTurnPhase` vi.fn（镜像真实 HubClient 面，hub-client.ts:1531）。
3. **frontend-ci（红，5 文件）**：CI（ubuntu 2 核）稳定失败、本地（Windows 20 核）同 coverage 仍全绿——指向执行环境差异而非断言错误。候选：跨文件泄漏与 2 核资源饥饿（红窗内套件新增 session-first-load-staged 等重文件）。定位手段：本地以 `--coverage --pool=threads --pool-options.threads.maxThreads=2` 全量复刻 CI 调度（后台执行中），按复现结果定修法（疑似 waitFor 预算/泄漏修复，不删断言）。
4. **backend-ci（红，已实锤非挂死）**：run 40341250526 终态 failure（非 timeout）——Pytest 实跑 40:55（< 45 分钟线），1 failed / 9217 passed：`test_machine_sillyspec.py::test_http_heartbeat_accepts_and_clears_sillyspec_status` 断言 sillyspec_status 落库键集时多出 `thin_flows`。根因：c326a4b2b（session-change-progress-hover）给心跳 sillyspec_status DTO 增 `thin_flows: list|None=None`（heartbeat.py:190），model_dump 整包直写把 None 键带进落库行；daemon 侧钉测试同步了（12→13 参），backend 侧这份 11 键精确断言漏更。修法：该测试单独对账 `_STATUS_KEYS | {"thin_flows"}` 并断言 None 默认——同文件另两处 `_STATUS_KEYS` 断言（服务层直写 dict/读侧视图，11 键）不受 DTO 注入影响，保持不动；新路径专项已有 test_heartbeat_thin_flows.py。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `notifyTurnPhase`（daemon.ts ClientLike 鸭子类型面）：**无签名变化**。行为契约收严为「任何同步/异步失败均不上抛」——原实现异步失败有 .catch、同步失败（client 无此方法）会外溢，属实现违背自身注释声明的契约，本次修正实现向契约对齐。
- `reportTurnPhase` / onTurnMessage 桥拦截：对 `_startInteractiveSession` 与 `_onMessage` 调用方而言**异常面收窄**（原本可能抛，现必不抛）；返回值/时序不变。
- 测试文件（3 个 daemon 测试）：mock 工厂与过滤断言调整，断言的生产行为主体（TASK 落行形状、pull→await→create 时序、thinkingLevel 三源回退）逐字不动。
- `.github/workflows/e2e-ci.yml`：仅 service image 字段值变化，job 步骤、端口、健康检查、env 不动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。turn_phase_report 本就设计为无序容忍（backend 侧按 phase 语义幂等，first_event 有 daemon 层防重 Set）。本变更不上报链路新增消息，只把「上报失败」从外溢改为吞噬——乱序面无新增假设。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不触任何持久化状态。reportTurnPhase 加固只包 try/catch；e2e-ci 镜像字段无并发面；测试夹具作用域单文件。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。`_startInteractiveSession` 在 SWR/spec_pull/mcp_prefetch/spawning/ready 五个阶段点调 reportTurnPhase——加固后任一点失败均走原「继续创建链」路径，与 D-009 裁决一致；会话创建失败回滚路径不受影响（原本也靠内层 catch）。测试 mock 的 notifyTurnPhase 返回 resolved promise，不影响 afterEach 的 daemon.stop() 排干。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。vi.mock 工厂作用域=单测试文件（vitest 默认隔离），importOriginal 引入真实 spec-sync.js 顶层（常量与函数声明，无 I/O 副作用）；e2e-ci 镜像只影响该 workflow 的 service 容器，不碰 deploy/ 生产 compose。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **最大风险**：daemon 源码 try/catch 加固若吞掉本应上抛的错误——已核对 reportTurnPhase 唯一职责是 fire-and-forget 上报（后端 POST），失败本就设计为不可见（D-009 + 2026-10-26-turn-phase-prod-fix 观测首警兜底），吞同步异常不改变任何业务承诺；且加固后被影响测试断言的是「create 被调用」「pull 被调用」，不依赖上报失败外溢。
- **断言收窄的掩盖风险**：task-lifecycle 过滤收窄可能掩盖未来真实旁路消息污染——对策：收窄精确到 `type==='turn_phase_report'`（不放宽为白名单制），TASK 行数/形状断言原样保留。
- **importOriginal 风险**：真实 spec-sync.js 顶层执行若未来引入副作用（如启动定时器）会进测试——记为已知取舍，当前顶层纯声明（已核对 export 清单）。
- **试过放弃的方案**：① 给 SessionManager deps 增加独立 `onTurnPhaseReport` 回调取代带内 `turn_phase_report` 消息——属 2026-10-26-session-stage-progress D-013④ 已定桥协议的重构，超出本修复变更范围且要动 archived 变更的契约，放弃；② frontend 删/跳过 5 个慢文件——掩盖手法，违反 FR-03「不得删断言」，放弃；③ backend-ci 撞顶再抬 timeout-minutes 到 60——治标，若无挂死实证不先动，留待 FR-04 判定。
