---
author: flow-machine-draft
created_at: 2026-10-13T08:50:00.000Z
---
# 任务注册表（Tasks）— 2026-10-13-anchor-mismatch-fix

- [x] task-01: scan_anchor_mismatches 批量扫描（一致错配 + 主导型两组，只读）；验证：test_scan_mismatch_reports_unanimous_run_targeting_single_change + test_dominant_mixture_reported_but_not_fixed 绿
- [x] task-02: fix_anchor_mismatches 修复（interactive 限定/混合排除/幂等）；验证：test_fix_mismatch 三用例绿
- [x] task-03: 脚本 --mismatch 模式（报告/--apply/--yes 门）；验证：test_scan_mismatch_is_read_only 绿 + --help 走查
- [ ] task-04: 相关测试全绿并按 pathspec 提交；验证：pytest 退出码 0
