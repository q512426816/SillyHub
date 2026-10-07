---
author: flow-machine-draft
created_at: 2026-10-07T15:08:47.462Z
---
# 任务注册表（Tasks）— 2026-10-07-ci-failures-sweep

- [ ] task-01: backend/tests/test_align_platform_change_events_migration.py 链尾锚更新为当前唯一 head 20261006200000 且该文件全绿
- [ ] task-02: test_files_router.py fixture 确定性选取活跃 change（不依赖排序巧合），test_list_files 全绿
- [ ] task-03: test_attachment_pipeline.py 两个 group 装配用例 member 夹具补 config_snapshot 并断言 D-003 模型透传，全绿
- [ ] task-04: test_archived_write_guard.py 懒激活退役用例改断言 TOOL_REPORT_TAKEOVER_INVALID，归档写入口兜底由 create 链既有守卫用例覆盖（docstring 注明），全绿
- [ ] task-05: precipitate-dialog.test.tsx 载荷断言回归 model 单串契约，全绿
- [ ] task-06: pre-session-picker.test.tsx 两处 caps 期望对象恢复 multimodal 键，全绿
- [ ] task-07: sessions page.test.tsx 供应商 mock 补 agent_kinds 必填字段，whoLine 用例全绿
- [ ] task-08: 本地仅跑上述相关测试文件全绿（全量留给 CI），四 workflow 推送后全绿
