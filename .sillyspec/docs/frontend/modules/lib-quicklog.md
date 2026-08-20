---
schema_version: 1
doc_type: module-card
module_id: lib-quicklog
author: qinyi
created_at: 2026-08-18 01:45:00
---

# QUICKLOG 条目客户端（lib-quicklog）

## 定位
QUICKLOG 条目级 API 客户端 + 轮询策略纯函数（`frontend/src/lib/quicklog.ts`，约 55 行）。条目级视图（列表过滤/分页/详情四段正文）从 `lib-knowledge` 拆出为独立客户端（knowledge 保留文档级 `listQuicklog/getQuicklog`），类型全部从 OpenAPI 生成（backend change 域 quicklog DTO）。供变更中心消费：QuicklogTable（快速修复 tab）、QuicklogDrawer（详情抽屉）、quicklog-linked-card（变更关联条目卡）、changes 列表页计数 pill。

## 契约摘要
- `listQuicklogEntries(workspaceId, params?: QuicklogListParams)` → `QuicklogEntryList`（items + total）。过滤参数：`search` / `status` / `author` / `linked_change` / `include_placeholder` / `page` / `page_size`（均只在有值时进 query）。
- `getQuicklogDetail(workspaceId, qlId)` → `QuicklogEntryRead`（在 `QuicklogEntryListItem` 基础上多 `body_sections` 四段正文、`raw_block` 原文、`truncated`）。
- `quicklogPollInterval(items): number | false` — 纯函数：存在 `in_progress` 或 `stale` 条目 → `30_000`，全终态/空列表 → `false`（停轮）。
- 类型引用：`QuicklogEntryListItem`（ql_id/title/status/status_note/placeholder/author_raw/author_name/linked_changes/files/affected_modules/source）、`QuicklogEntryList` / `QuicklogEntryRead` / `QuicklogFileItem`（path + 可选括注 note）均来自 `components["schemas"]`。
- 派生 `QuicklogStatus = "completed" | "in_progress" | "partial_done" | "stale"`（后端派生后 4 态，D-007）。

## 关键逻辑
```
GET  /api/workspaces/{ws}/quicklog-entries?search=&status=&author=
     &linked_change=&include_placeholder=&page=&page_size=
GET  /api/workspaces/{ws}/quicklog-entries/{qlId}
refetchInterval: (q) => quicklogPollInterval(q.state.data?.items ?? [])
```

## 注意事项
- `status` 是后端字符串，前端 `QuicklogStatus` 是派生视图类型——传参时以列表项实际返回为准，勿假设枚举穷尽。
- 列表行不带 body/raw（详情走 `QuicklogEntryRead`），抽屉按需拉取。
- `placeholder` 条目后端默认不返回（API 需显式 `include_placeholder: true`）；平台三
  消费点自 ql-20260820-008-fcb7 起默认显式传 true——进行中 quick 会话 CLI 只落
  「(quick 任务)」占位标题（真实标题 step3 `--done` 才回填），不传则会话全程不可见。
- 已核实的消费点：
  - `changes/page.tsx` — 计数 pill 用 `page_size: 1` 只取 total（含空壳占位，与表格口径一致）；
  - `quicklog-table.tsx` — `refetchInterval: (q) => quicklogPollInterval(q.state.data?.items ?? [])`；`showPlaceholder` 默认 true（复选框取消=收窄筛选）；
  - `quicklog-drawer.tsx` / `detail/quicklog-linked-card.tsx` — 详情与 linked_change 过滤（linked-card 同样含空壳占位）。
- 消费方全终态自动停轮，勿另设定时器。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
