---
author: qinyi
created_at: 2026-07-09 11:20:00
---

# quick 阶段状态在多会话下竞争回退

## 现象
同一项目（同一 `.sillyspec/.runtime/sillyspec.db`）下，多个并行 quick 会话（如本机同时开多个 Claude 会话各自跑 `sillyspec run quick`）会互相覆盖 quick 阶段状态：

- 会话 B 启动 quick 时，若 DB 里已有会话 A 推进到 step2 的状态，会话 B 直接从 step2 继续，**继承会话 A 的 step1（baseline + ql 绑定）**，不为自己的改动建独立 ql。
- 会话 B `--done step3` 时，post-check 找的是 step1 绑定的 ql（会话 A 的），与会话 B 实际改动不符，**状态回退到 step2**。
- 两个会话交替 `--done` / `--reset`，状态在 step2/step3 间反复横跳，无法收敛到 3/3。

## 复现（2026-07-09 multi-agent-platform）
本项目同日存在 3+ 个并行 quick 会话：
- ql-001 / ql-002：日志回显链路截断治理
- ql-003：normalize thinking_tokens
- ql-004（本次）：change-file-tree html 渲染预览 + 交互反转

ql-004 会话启动时继承 ql-002 的 step1（未建独立 ql，且被 ql-002 遗留③误判为「无关脏文件」）；`--done step3` 后状态回退到 step2；最终 `--reset` 清状态收尾，ql 记录手动补建。

## 根因
- quick 阶段状态存 `.runtime/sillyspec.db` 单行，**无会话/进程隔离**，多会话共享同一行。
- `quick-guard.json` 仅持久化「关联变更」选择，不隔离会话身份（且本例中该文件根本不存在，状态全在 db）。
- 无并发锁；QUICKLOG / 模块文档为普通文件，并发写会触发 `File has been modified since read`。

## 影响
- 改动无独立 ql 记录（需手动补建认领）。
- 流程无法正常 `--done` 收尾，进度卡在中间步。
- 并发写 QUICKLOG / `modules/*.md` 互相覆盖。

## 建议
- quick 阶段状态按会话/进程隔离：`quick-guard.json` 增加 `session_id`，或 `sillyspec.db` 的 quick 状态表加 `owner` 列 + 启动时检测「DB 状态非本会话创建」则强制重走 step1。
- 启动 `sillyspec run quick` 时检测到 DB 已有进行中的非本进程 quick，应告警或新建独立状态行，而不是静默继承。
