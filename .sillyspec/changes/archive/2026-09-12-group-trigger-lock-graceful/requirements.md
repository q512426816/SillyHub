# 需求：群聊触发链锁窗口优雅降级 + 共识任务行先行提交

- change: 2026-09-12-group-trigger-lock-graceful
- date: 2026-09-12
- author: qinyi

## 功能需求

### FR-1 触发链锁超时优雅降级
并发消息触发同批成员时，等成员行锁超时的触发协程：
1. 先尝试复用（对方已建完影子 → 直接复用走 inject，零等待快路径）；
2. 复用不可得 → 4xx「成员正在被触发中，请稍后重发」（群错误族），落入 send_group_message 既有部分失败收集（该成员 triggered 项带 error、群频道系统行、消息不丢）；
3. **不得 500**，不得回滚主事务。

### FR-2 共识任务行先行提交
use_consensus 分支创建的共识任务行在并行触发（gather）之前显式 commit：
1. 触发环节任何失败（含 FR-1 的报忙）不再吞任务行；
2. sweeper 30s 扫描可对「触发全失败」任务超时收口 aborted（前端状态卡展示终态）；
3. 语义=消息与任务同生（消息行已先 commit 落时间线）。

## 非功能需求

- NFR-1 防双建 FOR UPDATE 语义零变化（2026-09-02 引入的并发防护原样保留）。
- NFR-2 全局 lock_timeout=5s 不变（fail-fast 哨兵语义保留）。
- NFR-3 群链路存量 208 测试全绿；SQLite 测试环境零影响（锁超时路径 monkeypatch 注入）。
- NFR-4 真实环境复验：verify_consensus 独立库 + uvicorn 并发双消息前后对照（修复前 500+任务蒸发 → 修复后 4xx 部分失败+任务落库 sweeper 收口）。

## 验收标准

- AC-1（FR-1）：monkeypatch 注入 LockNotAvailableError + 指针已回填 → 复用断言；指针未回填 → 4xx + 部分失败收集断言。
- AC-2（FR-2）：use_consensus 消息 + 触发抛非 AppError → 独立 session 重读任务行存在（G-4 同款 rollback+refresh 手法）。
- AC-3（NFR-3）：群链路 9 文件 208 passed。
- AC-4（NFR-4）：真实环境并发场景修复后无 500、任务行落库、sweeper 收口 aborted。
