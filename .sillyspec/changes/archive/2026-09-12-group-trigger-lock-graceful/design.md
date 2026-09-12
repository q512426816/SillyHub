# 设计：群聊触发链锁窗口优雅降级 + 共识任务行先行提交

- change: 2026-09-12-group-trigger-lock-graceful
- date: 2026-09-12
- status: draft
- author: qinyi
- risk_level: integration-critical（触碰 daemon 域并发事务边界；无启动入口/迁移面）

## 1. 问题与证据

### 1.1 现场（archive/2026-09-10-group-agent-direct-chat verify 抓获，verify-uvicorn.log 11:23:18-11:23:28）

```
11:23:18.123  多 @ 消息 → 共识任务创建（主事务 commit：消息+时间线日志已落）
11:23:18.2x   成员A触发协程完成（懒建→WS 唤醒无连接→收口 failed）
11:23:23.205  成员B触发协程：SELECT ... FOR UPDATE agent_group_members 等锁 5s
              → asyncpg LockNotAvailableError（SQLSTATE 55P03）无人接 → 请求 500
              → 主事务回滚 → 共识任务行（flush 未 commit）被连带吞掉
11:23:28.627  第二个成员行同样超时 500（两次 500 各等 5s，不同成员行）
```

### 1.2 机制拆解

1. `send_group_message` 每个被 @ 成员一条**独立 session 协程**并行触发（`_trigger_member_isolated`，群 P2 并行编排）。
2. 懒建入口 `_ensure_shadow_session` 对**成员行** `SELECT ... FOR UPDATE`（2026-09-02 并发双建防护引入）。
3. **持锁事务在锁内做多段 IO**（dispatch lease flush → WS 唤醒探测 → 失败收口三连写 + commit）。daemon 在线时毫秒级；**daemon 缺位/掉线**时链路变长（叠加单进程事件循环阻塞，日志实测 blocked 1.1s），持锁窗口被拉长。
4. 并发第二条消息触发同成员 → 等锁 → 超全局 `lock_timeout=5s`（core/db.py fail-fast 配置）→ 语句被 PG 杀 → 异常非 AppError → gather fail-loud 上抛 → **整请求 500 + 主事务回滚**。
5. PG 死锁检测无法解围：持锁方在 asyncio 层等待（DB 视角 idle in transaction，非等待态），等锁方纯等待——无环可检。

### 1.3 存量性与放大面

- **500 本身是存量**：关闭共识开关走原触发链同场景同 500（verify 已实测对照）。
- **任务行连坐丢失是共识模式放大**：存量模式 500 只损失触发；共识模式任务行 flush 挂在主事务（gather 前无 commit），500 时消息已在时间线（先 commit）而任务蒸发——「消息在、任务没」的不一致状态，且 sweeper 无从兜底（任务行不存在）。

## 2. 修复方案（方案 C，与用户确认）

### 2.0 决策/方案选择（三案比选，选定 C）

| 决策 | 选定 | 理由 |
|---|---|---|
| D-1 三段式 vs NOWAIT/SKIP LOCKED vs 纯 try-except | **三段式** | NOWAIT/SKIP LOCKED 把所有正常竞争变立即失败/跳行，对方 100ms 后建完可复用的短竞争场景被误伤；纯 try-except 等满 5s 才报错且丢复用机会；三段式兼顾延迟（快路径零等待）/成功率（短竞争等一下就过）/诚实降级（长竞争报忙不重试） |
| D-2 超时后是否自动重试拿锁 | **不重试** | daemon 缺位时对方收口链本身就慢，重试大概率再等 5s 再超时；报忙让用户重发语义更诚实 |
| D-3 任务行 commit 时机 | **gather 前先行 commit** | 消息已先 commit 落时间线，任务与消息同生；触发失败由 sweeper 30s 超时收口（D-006 设计闭环按意图生效，非数据残留） |
| D-4 dispatch/WS 唤醒挪出持锁事务（治本重构） | **排除，后续独立变更候选** | 动懒建三元组事务边界（影子+run+lease 原子性），风险大，不搭车 |

### 2.1 修复①：`_ensure_shadow_session` 三段式锁语义（backend/app/modules/daemon/group/service/shadow.py）

```
段1 无锁快查：SELECT 成员行（populate_existing）→ shadow_session_id 已回填且影子非终态
    → 直接复用（并发对方已建完；零锁等待，覆盖大部分并发竞争窗口）
段2 指针空 → FOR UPDATE 正常等锁（防双建语义原样保留——daemon 在线时对方
    几十 ms 内 commit 释放，行为与现状一致）
段3 等锁超时（捕获 asyncpg LockNotAvailableError / SQLSTATE 55P03，
    经 SQLAlchemy DBAPIError.orig 判定）→ rollback（语句被 PG 取消后事务已废）
    → 无锁重读一次：指针已回填 → 复用（对方在超时窗口内建完）
                  未回填   → 抛 GroupChatInvalid（4xx 群错误族）
    「成员「X」正在被触发中，请稍后重发」——落入 send_group_message gather
    既有部分失败收集：该成员 triggered 项带 error 摘要 + 群频道系统行，
    消息已落时间线不丢，请求不 500
```

设计约束：
- **不自动重试拿锁**：daemon 缺位时对方收口链本身就慢，重试大概率再等 5s 再超时；报忙让用户重发，语义诚实。
- 防双建 FOR UPDATE 语义**原样保留**（段2）；三段式只是把「等待失败的处置」从无人接的 500 归化为已有错误族。
- 判定口径：`DBAPIError` 且 `orig` 为 `asyncpg.exceptions.LockNotAvailableError`（或 `sqlstate == '55P03'` 兜底）；SQLite 测试环境无该语义（既有测试零影响）。

### 2.2 修复②：共识任务行 gather 前显式 commit（backend/app/modules/daemon/group/service/messages.py）

- `use_consensus` 分支 `create_consensus_task`（flush-only）之后、`asyncio.gather` 之前：`await svc._session.commit()`。
- commit 前标量预取 `consensus_task_id_val = consensus_task.id` 等（仓库既有惯例，防 ORM expire 后隐性刷新）。
- 语义变化（有意）：任务行从「请求成功才存在」→「消息存在即存在」。消息行已先 commit 落时间线，任务与消息同生；触发全失败/部分失败时 sweeper 30s 扫描超时收口 aborted（D-006 超时必收口闭环按设计意图生效），前端状态卡可展示终态——**不是数据残留，是兜底闭环**。

### 2.3 非目标

- 不动 2026-09-02 防双建 FOR UPDATE 语义本身。
- 不动全局 `lock_timeout=5s`（fail-fast 语义保留——它是暴露问题的哨兵，不是问题本身）。
- 不做「dispatch/WS 唤醒挪出持锁事务」的治本重构（动懒建三元组事务边界，风险大，记为后续独立变更候选）。

## 3. 生命周期契约表

本变更不新增生命周期事件，但②改变既有共识任务行的可见时序（flush → 先行 commit），影响 sweeper 兜底链的触发条件：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 消息发送（多 @，共识开） | 用户 | backend 主事务 | 消息行+任务行（先行 commit） | 任务 open 落库（修复后：触发前即可见） |
| 触发失败/报忙（FR-1 4xx） | 触发协程 | gather 部分失败收集 | member error 摘要 | 任务**仍为 open**（不回滚不推进） |
| sweeper 超时扫描 | consensus_sweeper | 任务行 | timeout 到期 | open → aborted（write_consensus_card，D-006 既有闭环） |
| 成员行锁超时 | PG（lock_timeout） | 触发协程 | —（SQLSTATE 55P03） | 无状态变化（rollback；新接报忙 4xx） |

## 4. 测试设计

新增用例（NEW:backend/app/modules/daemon/tests/test_group_trigger_lock.py）：

1. **超时→复用**：monkeypatch 成员行 FOR UPDATE 抛 LockNotAvailableError + 第二次无锁读返回已回填指针 → 断言复用既有影子（不新建、不抛）。
2. **超时→报忙**：monkeypatch 同上 + 指针仍空 → 断言 GroupChatInvalid 4xx + gather 部分失败收集路径（该成员 error、其余成员正常、消息不 500）。
3. **任务行存活性**：use_consensus 消息 + 触发环节抛非 AppError 异常 → 独立 session 重读断言任务行已落库（G-4 同款 rollback+refresh 手法）。

回归：
- 群链路存量 9 文件 208 测试全绿。
- 真实环境复验（verify_consensus 独立库 + uvicorn）：并发双消息场景前后对照——修复前 500 + 任务蒸发；修复后 4xx 部分失败 + 任务落库 + sweeper 收口 aborted。

## 5. 自审

- 证据链：verify 现场时间线（11:23:18-28 两次 500）→ 机制五层拆解 → 存量性/放大面界定，全部可溯源到日志与代码行号。
- 声明与实现一致性：文件清单三项与方案一一对应；防双建语义声明「原样保留」与段2 设计一致。
- 风险表四项均有缓解；非目标三个明确（不混淆「不做」与「做不到」）。
- 无未实现声明、无绝对化断言；测试设计覆盖两个修复的失败分支而非只覆盖快路径。

## 6. 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| backend/app/modules/daemon/group/service/shadow.py | 改 | 三段式锁语义（~30 行） |
| backend/app/modules/daemon/group/service/messages.py | 改 | 共识任务行 commit 点前移（1-2 行 + 标量预取） |
| NEW:backend/app/modules/daemon/tests/test_group_trigger_lock.py | 新增 | 三用例（monkeypatch 注入锁超时：复用分支/报忙分支/任务行存活性） |

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 55P03 判定不准（异常包装层级） | 同时按 orig 类型 + sqlstate 双口径判定；单测覆盖注入路径 |
| commit 前移后对象过期误用 | 标量预取（同文件既有惯例）；回归 208 全量 |
| 段1 无锁读的竞态（读到未回填但对方即将建完） | 落段2 FOR UPDATE——正是防双建既有语义；无新增竞态面 |
| SQLite 测试不触发真锁 | 锁超时用 monkeypatch 注入，语义测试不依赖 PG |
