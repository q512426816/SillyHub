---
author: qinyi
created_at: 2026-06-03 16:51:54
---

# 变更文档完整度口径与归档门禁修复 — 设计

author: qinyi
created_at: 2026-06-03 16:51:54

## 背景

承接上一轮 quick 流程（default 变更，已修问题 1-3）。本变更补完变更中心遗留的展示层与门禁层问题，并修复连带发现的归档门禁契约断裂。依据文档：`C:\Users\qinyi\IdeaProjects\sillyspec\docs\sillyspec\file-lifecycle.md`（四件套为必需文档，plan/verify-result/module-impact 为阶段性产出，MASTER/prototype/reference 为可选）。

## 设计目标

1. 完整度"就绪"计数只以四件套为分母，可选/阶段性文档单独展示不计入。
2. 归档门禁 documents_complete 改判四件套是否齐全（exists），不依赖恒空的 status。
3. 归档门禁前端契约对齐后端真实返回，使 UI 恢复可用。

## 非目标

- 不修改后端归档门禁的 schema 与其余 5 项检查逻辑。
- 不为 ChangeDocument.status 补写入逻辑。
- 不触碰文档解析层。

## 总体方案

口径单一真相源：**必需文档 = {proposal, design, requirements, tasks}**。前端完整度分母、后端 documents_complete 共用此集合。

### 前端完整度卡片（问题 4）

在 `page.tsx` 引入两个常量：
- `REQUIRED_DOCS = ["proposal", "design", "requirements", "tasks"]`
- `OPTIONAL_DOCS = ["plan", "verify_result", "module_impact", "MASTER", "prototypes", "references"]`

卡片标题计数改为 `REQUIRED_DOCS.filter(exists).length / REQUIRED_DOCS.length`（即 X/4）。卡片主体拆两行：必需组（四件套，缺失标红）+ 可选组（其余，存在则绿、缺失灰显但不影响计数）。`DOC_TABS`（文档 Tab 切换区）保持原样全部展示，只是完整度计数口径改变。

### 后端归档门禁（问题 5）

`service.py` 的 `check_archive_gate` 中 documents_complete 检查：
```python
REQUIRED_DOC_TYPES = {"proposal", "design", "requirements", "tasks"}
docs, _, _ = await self.get_documents(workspace_id, change_id)
existing_types = {d.doc_type for d in docs if d.exists}
missing = REQUIRED_DOC_TYPES - existing_types
checks.append(ArchiveCheckItem(
    name="documents_complete",
    passed=len(missing) == 0,
    detail="" if not missing else f"缺少必需文档: {', '.join(sorted(missing))}",
))
```
不再使用 `not d.status` 判定。

### 前端归档门禁契约对齐（问题 3 连带）

后端为契约基准，前端对齐：
- `changes.ts`：`ArchiveCheckItem` → `{ name: string; passed: boolean; detail: string }`；`ArchiveGateResponse` → `{ can_archive: boolean; checks: ArchiveCheckItem[] }`（删 `failed_checks`）。
- `page.tsx`：归档门禁渲染从 `archiveGate.failed_checks.find((c) => c.check === item.check)` 改为 `archiveGate.checks.find((c) => c.name === item.check)`，`passed` 直接取该项 `.passed`，说明取 `.detail`；badge 未通过计数改为 `archiveGate.checks.filter((c) => !c.passed).length`。

## 文件变更清单（必填）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 新增 REQUIRED_DOCS/OPTIONAL_DOCS 常量；完整度卡片分区+分母改四件套；归档门禁渲染改用 checks/name/passed/detail |
| 修改 | frontend/src/lib/changes.ts | ArchiveCheckItem→{name,passed,detail}；ArchiveGateResponse.failed_checks→checks |
| 修改 | backend/app/modules/change/service.py | check_archive_gate 的 documents_complete 改判四件套 exists |
| 修改 | backend/app/modules/change/tests/test_service.py | 新增/调整 documents_complete 的门禁测试（四件套齐全通过、缺件失败） |

> 注：若 change 模块无 test_service.py，则归档门禁测试加入既有的门禁测试文件（execute 阶段确认实际位置）。

## 接口定义

后端 `ArchiveGateResponse`（不变，作为契约基准）：
```
ArchiveGateResponse { can_archive: bool, checks: ArchiveCheckItem[] }
ArchiveCheckItem    { name: str, passed: bool, detail: str }
```
6 项检查 name 固定：no_unresolved_feedback / ac_confirmed / tech_verification_passed / business_review_passed / feedback_categorized / documents_complete。

## 数据模型

无表结构变更。仅改变 `check_archive_gate` 对 `ChangeDocument.exists` 的读取方式；`ChangeDocument.status` 保持现状（不再被门禁依赖）。

## 兼容策略（brownfield）

- 本项目未上线，无数据兼容负担。
- 归档门禁 UI 此前因契约不符即为不可用状态，本次修复为净改善，无回退需求。
- 完整度计数口径变化仅影响展示，不改变任何持久化数据或 API 契约。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | change 模块归档门禁测试文件位置/命名与假设不符 | P2 | execute 阶段先 grep 定位 check_archive_gate 既有测试，就地扩展 |
| R-02 | 前端 page.tsx 归档门禁渲染区还有其他地方引用 failed_checks | P1 | 改前 grep failed_checks 全量定位，逐处替换；tsc 兜底 |
| R-03 | 完整度卡片与 DOC_TABS Tab 区共用 docExistsMap，改动相互影响 | P2 | 仅改完整度计数逻辑，不动 Tab 切换与内容加载 |

## 自审

- 口径一致性：前端分母与后端 documents_complete 共用四件套集合 {proposal,design,requirements,tasks}，已对齐 ✅
- doc_type 命名：使用上一轮 quick 已统一的 verify_result/module_impact，无 verification 残留 ✅
- 契约方向：以后端 schema 为基准改前端，避免动后端影响其他调用方 ✅
- 范围控制：未扩展到 status 写入、未改其余 5 项门禁、未碰解析层，符合 YAGNI ✅
- 可测性：documents_complete 有明确的"齐全通过/缺件失败"判定，可单测；前端靠 tsc + 手动验证 ✅
- 未决项：test_service.py 是否存在需 execute 阶段确认（R-01），不阻塞设计。
