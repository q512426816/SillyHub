---
author: flow-machine-draft
created_at: 2026-10-01T11:23:25.837Z
---
# 任务注册表（Tasks）— 2026-10-01-review-followup-reset-guard-machineid

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge + 2026-09-29 心跳指针）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。📌 任务面在 ①spec 阶段定稿：覆写为真实实现步骤（全 `- [ ]`）后再动代码；执行循环：Working on task N/M → 做一件 → 勾一格 → 下一个——收口硬门拒单拍多格勾选（--allow-batch-tick 可显式旁路留痕）。`flow status --change <名>` 为自愿查看/恢复面（恢复时给下一任务指针与进度，非协议必需——D-007）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: 后端 reset 软删守卫——test_takeover.py 新增「软删会话重置 404」用例（预期先红：现查询缺守卫返回 200）
- [x] task-02: helpers.reset_tool_report_session 会话查询补 `col(AgentSession.deleted_at).is_(None)`（对齐 takeover 同款），task-01 用例转绿（实测：红→1 passed）
- [x] task-03: daemon machine-id 加固测试——config-machine-id.test.ts 新增「非 uuid 形半写残片自愈覆写」用例（实测先红：旧实现非空即采纳残片）
- [x] task-04: config.ts readOrCreateMachineId 改 uuid 形状校验 + wx 独占创建 + 冲突回读胜者 + 非 uuid 形覆写自愈，注释如实化（去「原子落盘」表述），task-03 用例转绿且既有三用例不回归（实测：4 passed）
- [x] task-05: 跑触达相关测试——backend `uv run pytest app/modules/daemon/tests/test_takeover.py` 16 passed + ruff 两触达文件 All checks passed；daemon `pnpm vitest run tests/config-machine-id.test.ts` 4 passed + `pnpm typecheck` 干净
