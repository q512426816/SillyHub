---
author: qinyi
created_at: 2026-07-26 12:40:00
---

# 平台未连接时 --done 进程不退出 + timeout 包裹丢 archive 步骤进度

> 发现于 2026-07-25-daemon-borrow-for-business verify/archive 阶段（2026-07-26）。
> CLAUDE.md 规则 15：SillySpec 工具缺陷记录（活跃坑，待工具修复）。

## 现象

平台未连接（未跑 `sillyspec platform connect`）时，`sillyspec run <stage> --done` 出现两个相关问题：

**A. node 进程不退出（sync 挂起）**

`--done` 完成本职工作（打印 `✅ 阶段已完成`、写进度、`[sync] 未连接平台，请先 sillyspec platform connect`）后，**node 进程不退出**，长时间滞留（实测 verify --done 滞留 7min+ 仍不退出，输出早已打完）。exit code 最终是 0，但进程迟迟不 return。

**B. 用 `timeout` 包裹 `--done` 会丢 archive 步骤进度**

为绕过 A 的挂起，用 `timeout 90 sillyspec run archive --done ...` 包裹。结果：archive step2/step3 的 `--done` 被 timeout SIGTERM 杀后，**步骤进度未持久化**——`--status` 仍显示 step2 当前（step1 only done），尽管命令输出里已打出下一 step 的 prompt。verify 的 `--done` 用同样 timeout 包裹则进度正常持久化（7/7 落盘）——**进度写入时机 verify 与 archive 不一致**。

## 根因（疑似）

- A：平台 sync 在未连接时进入重试/退避循环或有未 unref 的定时器/句柄撑住 node 事件循环，本职工作（含进度落盘）做完后进程仍不退出。输出里 `[sync] 未连接平台` 提示只是打印，并非放弃同步。
- B：archive 的 `--done` 进度落盘点相对靠后（疑似在 sync 尝试附近），`timeout` 的 SIGTERM 恰好打在落盘前 → 进度丢失。verify 的落盘点更靠前（在 sync 之前），故 timeout 杀不掉进度。两者落盘时机不一致是核心。
- 进程不退出的情况下，"命令输出已显示下一 step prompt" ≠ "进度已落盘"——容易被输出误导，以为推进了。

## 影响

- A：CI/脚本（非交互）里 `--done` 会卡住整个流水线；交互里需手动 Ctrl-C / 杀进程。
- B：archive 阶段用 timeout 绕过 A 时，静默丢步骤进度，`--status` 回退，需重跑该 step（重跑时若又用 timeout 则又丢，陷入循环）。

## 临时绕过（用户侧，已验证有效）

**不要用紧的 `timeout` 包裹 `--done`；让进程自然完成。** 二选一：

1. **后台跑 + 轮询**（最稳）：
   ```bash
   sillyspec run archive --done --change <名> --non-interactive --output "..." &
   # 等 10-15s 后另开查询
   sillyspec run archive --change <名> --status   # 确认进度落盘
   ```
   实测 archive step2 后台跑 ~15s 自然 exit 0，进度正确持久化。
2. **前台跑 + 宽超时**（如 120s+），多数情况进程会在 sync 退避后自行退出。

判定"真完成"以 `--status` 为准，**不要看命令是否 return / 是否打出下一 step prompt**。

## 建议（工具侧修复）

优先级从高到低：

1. **平台未连接时 sync 应快速跳过**：检测到未连接（无 token / 连接失败）直接 no-op 返回，不进重试/退避，不让任何定时器/句柄撑住事件循环——`--done` 本职做完即 `process.exit(0)`。
2. **统一进度落盘时机**：所有 stage 的 `--done` 在"做本职工作第一步"就持久化进度（远在任何 sync/网络调用之前），保证即便后续被信号杀、崩溃、断网，进度也不丢。verify 当前的早落盘行为应推广到 archive 等全部 stage。
3. **`--non-interactive` 下禁用平台 sync**或显式 `--no-sync` 开关：CI/脚本场景明确不需要回传平台，避免无谓挂起。
4. （可选）`--done` 收到 SIGTERM 时 flush 进度后再退出（graceful shutdown），兜底 timeout 场景。

## 复现

- 环境：本机 Windows，平台未 `sillyspec platform connect`（输出含 `[sync] 未连接平台`）。
- A：`sillyspec run verify --done --change <名> --non-interactive --output "..."` → 打出 `✅ verify 阶段已完成（7/7）` + `[sync] 未连接平台` 后进程不退出（>7min）。
- B：`timeout 90 sillyspec run archive --done --change <名> --non-interactive --output "..."`（step2/3）→ 命令输出显示下一 step prompt，但 `--status` 仍为上一 step 当前（进度未落盘）。同命令改后台不 timeout 跑 → 进度正常落盘。

## 关联

- 同类"输出已完成但状态未落盘"误导：[[quicklog-may-diverge-from-commit]]（quicklog 写"已完成"≠真 commit）——本坑是 stage 进度版的同型问题。
- 影响 daemon-borrow 归档过程：archive step2/3 进度曾因此回退重跑（改后台跑后通过）。
