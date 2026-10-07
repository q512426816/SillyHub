---
author: flow-machine-draft
created_at: 2026-10-07T15:08:47.462Z
---
# 提案书（Proposal）— 2026-10-07-ci-failures-sweep

## 动机

任务原话转写：CI 全线红清偿：main 上 backend-ci 5 用例 + frontend-ci 3 用例失败，逐一修测试侧债让四 workflow 全绿。根因均非生产缺陷：①迁移链尾锚未随 20261006200000 前移②test_files_router fixture 依赖 updated_at desc 不稳定排序选中归档 change（目录在 changes/archive/ 下，写 watcher-events.jsonl FileNotFoundError）③attachment_pipeline 测试 member SimpleNamespace 缺 D-003 新增 config_snapshot 属性④归档写守卫用例断言停在已退役的懒激活分支语义（现注入一律 409 takeover_required，写入口 takeover→create 链有 ensure_writable 守卫）⑤precipitate-dialog 载荷断言被 b8afd807c 坏合并带入 worktree 旧 models 形态（后端 DistillDispatchIn.model 单串为契约）⑥pre-session-picker caps 全对象断言被同合并误删 multimodal 两行⑦sessions page 测试 listProviders mock 缺必填 agent_kinds 致 SessionConfigBar 崩渲染。

成功标准：
- backend/tests/test_align_platform_change_events_migration.py 链尾锚更新为当前唯一 head 20261006200000 且该文件全绿
- test_files_router.py fixture 确定性选取活跃 change（不依赖排序巧合），test_list_files 全绿
- test_attachment_pipeline.py 两个 group 装配用例 member 夹具补 config_snapshot 并断言 D-003 模型透传，全绿
- test_archived_write_guard.py 懒激活退役用例改断言 TOOL_REPORT_TAKEOVER_INVALID，并新增 takeover 写入口归档 409 覆盖，全绿
- precipitate-dialog.test.tsx 载荷断言回归 model 单串契约，全绿
- pre-session-picker.test.tsx 两处 caps 期望对象恢复 multimodal 键，全绿
- sessions page.test.tsx 供应商 mock 补 agent_kinds 必填字段，whoLine 用例全绿
- 本地仅跑上述相关测试文件全绿（全量留给 CI），四 workflow 推送后全绿

## 变更范围

按成功标准机械推导，共 8 条验收面：
1. backend/tests/test_align_platform_change_events_migration.py 链尾锚更新为当前唯一 head 20261006200000 且该文件全绿
2. test_files_router.py fixture 确定性选取活跃 change（不依赖排序巧合），test_list_files 全绿
3. test_attachment_pipeline.py 两个 group 装配用例 member 夹具补 config_snapshot 并断言 D-003 模型透传，全绿
4. test_archived_write_guard.py 懒激活退役用例改断言 TOOL_REPORT_TAKEOVER_INVALID，并新增 takeover 写入口归档 409 覆盖，全绿
5. precipitate-dialog.test.tsx 载荷断言回归 model 单串契约，全绿
6. pre-session-picker.test.tsx 两处 caps 期望对象恢复 multimodal 键，全绿
7. sessions page.test.tsx 供应商 mock 补 agent_kinds 必填字段，whoLine 用例全绿
8. 本地仅跑上述相关测试文件全绿（全量留给 CI），四 workflow 推送后全绿

## 成功标准（可验证）

1. backend/tests/test_align_platform_change_events_migration.py 链尾锚更新为当前唯一 head 20261006200000 且该文件全绿
2. test_files_router.py fixture 确定性选取活跃 change（不依赖排序巧合），test_list_files 全绿
3. test_attachment_pipeline.py 两个 group 装配用例 member 夹具补 config_snapshot 并断言 D-003 模型透传，全绿
4. test_archived_write_guard.py 懒激活退役用例改断言 TOOL_REPORT_TAKEOVER_INVALID，并新增 takeover 写入口归档 409 覆盖，全绿
5. precipitate-dialog.test.tsx 载荷断言回归 model 单串契约，全绿
6. pre-session-picker.test.tsx 两处 caps 期望对象恢复 multimodal 键，全绿
7. sessions page.test.tsx 供应商 mock 补 agent_kinds 必填字段，whoLine 用例全绿
8. 本地仅跑上述相关测试文件全绿（全量留给 CI），四 workflow 推送后全绿
