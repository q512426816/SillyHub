---
author: flow-machine-draft
created_at: 2026-10-18T12:31:35.167Z
---
# 任务注册表（Tasks）— 2026-10-18-change-type-git-conventional

- [x] task-01: 后端 reparse：变更目录 flow-state.yaml 含 commit_type 字段时作为权威类型写入 change_type（允许覆盖库中已有旧值）；无该字段的变更保持现有目录推断与只为空回填行为不变
- [x] task-02: 回填脚本：遍历归档变更，git 提交信息反查变更 key，排除 chore(archive)，按优先级（feat/fix > perf/refactor/test > docs/style > build/chore）取主类型，幂等写入该变更 flow-state.yaml（已存在则替换该行，最小 diff）
- [x] task-03: 前端详情页「类型」行改为彩色标签：已知类型（feat/fix/docs/chore/perf/refactor/test/build/style）固定配色，未知类型中性样式显示原值，空值显示 —
- [x] task-04: 聚焦测试：parser commit_type 读取用例、_apply_parsed 权威覆盖用例、change-overview-side 类型标签用例全绿；前端 tsc 通过
- [x] task-05: 本仓回填 dogfood：脚本跑完后抽验 2026-10-17-session-envelope-rev-stale-guard 的 flow-state.yaml 含 commit_type: fix
