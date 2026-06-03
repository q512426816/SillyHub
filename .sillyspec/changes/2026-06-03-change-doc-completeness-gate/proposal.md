---
author: qinyi
created_at: 2026-06-03 16:51:54
---

# 变更文档完整度口径与归档门禁修复

## 动机

变更中心详情页的"变更文档完整性"卡片和归档门禁是两个相关但都失真的功能。上一轮 quick 流程修复了文档解析层的问题 1-3（MASTER 可选、parser 不读 frontmatter、doc_type 统一），但遗留了展示层和门禁层的问题 4-5。本变更补完这两项，并修复连带发现的归档门禁前后端契约断裂。

## 关键问题

1. **完整度分母把可选文件算进必需**：前端 `DOC_TABS.length`（10 项，含 MASTER/prototypes/references 等可选文件）作分母，但 SillySpec 规范里真正必需的只有四件套（proposal/design/requirements/tasks）。结果"X/N 就绪"永远凑不齐，完整度展示有误导，用户无法据此判断变更是否真的具备推进条件。

2. **归档门禁 documents_complete 必然失败**：后端 `check_archive_gate` 用 `[d for d in docs if not d.status and d.exists]` 判断文档是否完成，但 `ChangeDocument.status` 解析器从不写入（恒为 None），所以任何存在的文档都被判为"未完成"，该检查项必然失败——逻辑意图（必需文档是否齐全）从未真正生效。

3. **归档门禁前后端契约完全断裂**：后端返回 `{can_archive, checks:[{name,passed,detail}]}`，前端 `ArchiveGateResponse` 却期望 `{can_archive, failed_checks:[{check,message}]}`，字段名、结构全不一致。归档门禁 UI 实际上是死的——即便修了问题 5，前端也读不到。这是问题 5 的必要连带项。

## 变更范围

- 前端完整度卡片：拆分必需（四件套）与可选/阶段性文档两组，"就绪"计数分母只算四件套。
- 后端归档门禁：`documents_complete` 改判四件套 doc_type 是否都 `exists`，与前端分母口径一致，不再依赖恒空的 `status`。
- 前端归档门禁契约：`changes.ts` 与 `page.tsx` 对齐后端真实返回（`checks` / `name` / `passed` / `detail`）。

## 不在范围内（显式清单）

- 不动后端 `ArchiveGateResponse` / `ArchiveCheckItem` schema（以后端为契约基准，改前端对齐）。
- 不改变归档门禁其余 5 项检查（no_unresolved_feedback / ac_confirmed / tech_verification_passed / business_review_passed / feedback_categorized）的判定逻辑。
- 不给 `ChangeDocument.status` 补写入逻辑（本次直接绕开该字段，不引入新的状态写入路径）。
- 不动文档解析层（parser / spec_paths，已在上一轮 quick 完成）。

## 成功标准（可验证）

- 完整度卡片对一个只有四件套的变更显示"4/4 就绪"，可选文档缺失不影响该计数。
- 归档门禁 `documents_complete` 在四件套齐全时通过、缺任一件时失败，且 `detail` 指明缺哪些。
- 归档门禁 UI 能正确渲染后端返回的 6 项检查（通过/未通过 + 说明），不再因字段不匹配而空白。
- 后端 change 模块测试全通过；前端 `tsc --noEmit` 0 错误。
