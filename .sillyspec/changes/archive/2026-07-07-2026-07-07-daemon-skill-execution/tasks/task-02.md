---
author: qinyi
created_at: 2026-07-07 13:35:00
goal: 改 daemon task-runner 删除写 CLAUDE.md 逻辑并改为 spawn claude 时传 stage_meta/skill 调用指令
implementation: 删除 sillyhub-daemon/src/task-runner.ts:457-463 写 .claude/CLAUDE.md 的逻辑；claude 启动 prompt 改为内嵌 skill 调用指令（如 `/sillyspec-verify --change <id> --stage verify`，skill 自己解析 args，不写文件）；spawn claude 时注入环境变量 STAGE_META=<stage_meta JSON>（task-01 的 StageDispatchMeta 序列化）作为 prompt 截断的兜底
acceptance: task-runner 不再写 worktree .claude/CLAUDE.md；claude 启动同时收到 skill 调用 prompt 指令 + env STAGE_META；单测覆盖 stage_meta 传递与不写 CLAUDE.md
verify: cd sillyhub-daemon && pnpm test（task-runner stage_meta 传递 + 不写 CLAUDE.md 单测）
constraints: 复用 task-01 定义的 StageDispatchMeta 字段（不另造结构）；保留 task-runner 既有 spawn/forward 链路（只改 prompt 来源 + env 注入 + 删写文件）；兼容 daemon-client 与 server-local 两条 spawn 路径（server-local 对齐由 task-07 处理）
depends_on: [task-01]
covers: [FR-01, FR-02, D-001@V1, D-005@V1, D-007@V1]
---

# task-02: daemon task-runner 改（删写 CLAUDE.md + stage_meta 传递）

## 验收标准

A. sillyhub-daemon/src/task-runner.ts:457-463 覆盖写 .claude/CLAUDE.md 的代码块被完全删除，grep 确认 task-runner 中无 fs.writeFile/writeFileSync 指向 .claude/CLAUDE.md 的调用。
B. spawn claude 时 prompt 内嵌 skill 调用指令（`/<skill_name> --change <change_id> --stage <stage>` 格式），同时通过 spawn env 注入 STAGE_META（StageDispatchMeta 的 JSON 序列化，含 change_id/stage/skill_name/workspace_id/spec_root_ref）；单测断言 spawn 参数同时含 skill 指令 prompt 与 STAGE_META env。
C. sillyhub-daemon `pnpm test` 全绿，新增单测覆盖"不写 CLAUDE.md"+"stage_meta prompt+env 双通道传递"，且 task-runner 既有 spawn/forward/usage 提交链路零回归。
