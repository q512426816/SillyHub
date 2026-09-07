---
author: qinyi
created_at: 2026-09-07 08:58:30
---

# brainstorm 契约通过但 plan-postcheck 文件清单解析为空（两道门解析器不一致）

- 踩坑时间：2026-09-07，变更 2026-09-07-arch-large-file-split plan step 5
- 现象：design.md 的「文件变更清单」用 `### main 仓变更` 子标题 + `**Wave 1 — xxx：**` 加粗分段 + 多张表的组织形式（标题也带编号 `## 6. 文件变更清单`），brainstorm --done 的 `brainstorm.design.file-change-list` 契约（字面命中）通过；到 plan step 5 postcheck 报「design.md 缺少『文件变更清单』章节（或清单解析为空），无法做文件覆盖对账」硬阻断。
- 根因（两次排查定位）：plan-postcheck 只认「## 文件变更清单」标题**紧随的单一平铺表格**；编号标题、子标题、加粗分段段落都会让清单解析为空。归档先例（2026-05-30-change-writer、2026-09-04-session-task-execution-panel 等）全部是标题下一张平表。
- 绕过方案：design.md 的清单章节改为无编号标题 + 单一平铺表（Wave 归属写进说明列前缀 [W1]/[W2]/[W3]），说明性引言放表格下方；改后 postcheck 通过。
- 建议（给工具）：①plan-postcheck 表格解析支持多表合并/跳过分段文字；②或 brainstorm 阶段就用 postcheck 同一套解析器预检清单可读性，错误提前到产出阶段报。
