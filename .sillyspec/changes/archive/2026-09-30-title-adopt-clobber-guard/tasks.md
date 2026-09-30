---
author: flow-machine-draft
created_at: 2026-09-30T00:34:57.824Z
---
# 任务注册表（Tasks）— 2026-09-30-title-adopt-clobber-guard

> 机器预填草稿已被 agent 按实际实现路径覆写（保持 checkbox 行形态）；验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。

- [x] task-01: title_norm 收敛两助手——`is_fallback_display_title`（空/等于 key/等于去日期前缀判定，三写路径共用）+ `TITLE_MAX_LEN=500`（与 Change.title String(500) 同宽），附 test_title_normalization.py 纯函数用例
- [x] task-02: platform_sync `_ensure_change_row` 收养段加固——判定换 `is_fallback_display_title`、body_title 截断 TITLE_MAX_LEN、commit 包 try/except best-effort（失败告警不阻断 progress 上行）；占位建行 title 同口径截断；附超长截断 + 200 不变用例
- [x] task-03: `_sync_change_title_from_documents` 兜底回翻守卫——派生值为兜底形态且既有 title 为语义标题时不覆盖；自定义 H1（--title 改名通道）恒覆盖；附收养后模板 H1 推送不回翻 / 自定义 H1 仍覆盖两用例
- [x] task-04: change `_apply_parsed` 兜底回翻守卫（reparse 路径同规则）；附单元用例（兜底 parsed.title 不覆盖语义行 title / 自定义 parsed.title 仍覆盖）
- [x] task-05: 相关测试全绿——test_change_deleted_guard.py + test_title_normalization.py + test_router.py -k documents + ruff/mypy 相关文件零新增问题
