---
author: qinyi
created_at: 2026-07-07 13:35:00
goal: 实现 claude 必调指定 skill 的三层强制保障（明确 prompt 指令 + allowedTools 不限 skill + 兜底检测报错）
implementation: 在 task-02 spawn claude 基础上加三层保障——① prompt 是明确 skill 调用指令（非开放式任务，`/<skill_name> --change X --stage Y`）；② claude --allowedTools 不限制 skill 类工具（确保 skill 可触发）；③ 兜底：daemon 解析 claude 输出，检测到 "skill not found" / turn 结束无 skill 调用痕迹时标记 run 失败 + 报错（不静默，对齐 NFR-01）
acceptance: prompt 含明确 skill 调用指令；--allowedTools 不含限制 skill 的规则；claude 未调 skill（输出含 skill not found 或无 skill 痕迹）时 run 被标失败而非静默通过
verify: cd sillyhub-daemon && pnpm test（强制保障兜底检测单测：正常调 skill 通过 / 未调 skill 报错两路径）
constraints: 三层保障对齐 design §5.1.1 gap 2 + NFR-01（不静默跳过）；兜底检测复用 task-02 spawn 后的输出解析链路（不另起监听）；不改 skill 内容本身（design §3 非目标）
depends_on: [task-02]
covers: [NFR-01, D-001@V1]
---

# task-08: claude 调 skill 强制保障

## 验收标准

A. task-runner spawn claude 的 prompt 是明确的 skill 调用指令（`/<skill_name> --change <id> --stage <stage>` 格式，非开放式任务描述），单测断言 prompt 匹配该调用模式。
B. claude 启动 --allowedTools 参数不包含限制 skill 触发的规则（skill 类工具可用）；同时 env STAGE_META 已注入（task-02），三层保障的前两层就位。
C. sillyhub-daemon `pnpm test` 全绿，新增兜底检测单测覆盖：① claude 输出含 "skill not found" 或 turn 结束无 skill 调用痕迹 → run 标记 failed + 报错（不静默）；② claude 正常调 skill → 正常完成；满足 NFR-01 不静默跳过。
