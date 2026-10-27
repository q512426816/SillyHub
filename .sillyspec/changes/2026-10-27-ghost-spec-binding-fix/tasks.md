---
author: flow-machine-draft
created_at: 2026-10-27T00:51:08.037Z
---
# 任务注册表（Tasks）— 2026-10-27-ghost-spec-binding-fix

- [x] task-01: binding.py 写侧拒绝分支——`bind_session_to_change` 查库未命中且 change_key 不匹配 `^\d{4}-\d{2}-\d{2}-` 时 log.warning + 返回 None（不建 placeholder/link）；带 `test_bind_change_rejects_undated_new_key_no_placeholder` 用例验证（changes/links 行数不变 + 返回 None）
- [x] task-02: binding.py 兼容面用例——新增 `test_bind_change_binds_existing_undated_row_without_placeholder`（旧格式名已有行 → 返回该行 id、无第二行、link 恰一条），并确认既有 FR-02 用例 `test_bind_change_creates_placeholder_with_ensure_defaults`（带前缀照建）不动仍绿
- [x] task-03: service.py 读侧过滤——`list_changes_for_session` 对 draft+active 行批量 IN 查 change_documents，滤「无文档 + created_at 超 `_GHOST_PLACEHOLDER_MIN_AGE`(30min)」行；新增端点用例 `test_ghost_placeholder_filtered_after_ttl`（41 分钟幽灵行不出现）
- [x] task-04: 读侧零误伤护栏用例——`test_fresh_placeholder_not_filtered`（5 分钟无文档 draft 行保留）+ `test_documented_archived_non_draft_rows_not_filtered`（有文档超龄 draft / archive 无文档 / status=active 无文档三变体全保留）
- [x] task-05: binding.py 通道 B 段首收紧——run/flow 两族 sillyspec 定位要求段首或紧随 exec（引号内字面量不再误解析），新增 `test_extract_spec_bindings_quoted_text_not_binding`（--input 内嵌示例命令只产出真实绑定）+ 包装 exec 用例回归，既有样例库全绿
- [ ] task-06: 前端实时性——`useSessionChanges` 关闭态 30s 低频轮询（`refetchInterval: active ? 15_000 : 30_000`）+ `SessionChangeFilesHover` 下拉/弹窗打开沿立即 refetch；新增轮询策略与打开即拉新用例
- [ ] task-07: 跑相关测试收口——backend 两组（test_spec_binding.py + test_session_changes_endpoint.py）与 frontend 相关用例（session-change-files-hover.test.tsx）全绿，勾选证据随交付提交
