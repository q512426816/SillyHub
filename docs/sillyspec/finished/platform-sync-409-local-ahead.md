# 平台同步 409：本地 sillyspec 进度领先平台（:8001）时每次 --done 推送被拒且持续告警

- 发现：2026-08-22-session-panel-unify execute 阶段（首次出现于 execute step1，此后每次 --done 重复）。
- 现象：`[sync] POST http://127.0.0.1:8001/api/changes/<变更名>/progress → 409 {"conflict":true,"platform_progress":{…,"current_stage":"plan",…}}` + 「平台同步冲突：推送被拒（base_ts 过期，平台已有更新）」横幅。本地状态机不受影响（步骤正常推进、产物校验门正常走），纯同步层噪音。
- 根因推断：本地 CLI 推进度带 base_ts 时间戳，平台侧该变更记录的 base_ts 更新（可能由另一并发会话/平台自身写入），CLI 检测到过期后拒绝覆盖（fail-closed），但**没有提供任何解决命令**（无 --force-sync / re-base 入口），冲突一旦形成便每次 --done 都告警直到阶段结束。
- 影响：无功能阻断；但告警横幅干扰输出、且平台侧进度长期停在旧阶段（plan），平台 UI 上看本变更状态失真。
- 规避（确认有效）：`sillyspec platform resolve <变更名> --keep-local`（本地为真相源时）→ 自动推送平台闭环，无需再手动 sync；异机/平台为准场景用 `--take-platform`。早期版本（3.20.x 前？）曾无此命令只能硬扛告警，2026-08-22 实测 resolve 可用。变更收尾后观察平台收敛。
- 待工具修复方向：① 409 首次出现时直接在告警里提示 resolve 命令（而不是持续告警若干次后才给）；② base_ts 冲突判定加宽（同 change 同 stage 的顺序推进不应视为冲突）。
- 状态：已有绕过方案（platform resolve），工具侧仍可优化提示时机。会话：2026-08-22-session-panel-unify。
