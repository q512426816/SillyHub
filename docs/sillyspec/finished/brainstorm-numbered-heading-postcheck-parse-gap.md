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

## 处置记录（2026-09-08 定时收口，已修复归档）

- **已修复**（sillyspec 仓 commit 2cc308b，随 v3.28.2 发版）：`change-list.js` 清单解析器大幅增强——①`FILE_LIST_SECTION_RE` 容忍编号标题前缀（`## 6. 文件变更清单` / `## 6)`）；②子标题（`### xxx 仓变更` 等）按 include/exclude/操作分类处理，不再让解析为空；③加粗分段段落（`**Wave 1 — xxx：**`）自然跳过；④多表合并（后续表头行被无害吞掉），表头列序自适应。
- **实测验证（2026-09-08，事故原形态）**：`## 6. 文件变更清单` + 仓库子标题 + Wave 加粗分段 + 两仓三张表 → 5 个路径全部解析成功且操作标签正确（修改/新增）。
- **两道门对齐**（本坑建议②）：plan-postcheck 与 brainstorm 契约识别集已对齐（change-list.js 头注释明示「与 src/stage-contract.js 的识别集对齐，避免两个校验器矛盾结论」），plan-postcheck 直接 import `parseFileChangeList` 单一真相源，跨仓段（`## <repo> 仓变更`）经临时文件复用同一 parser——「brainstorm 通过、postcheck 解析为空」的结构性矛盾已消除。
- 绕过方案（无编号标题+单平铺表）不再需要，Wave 组织写法可保留。
