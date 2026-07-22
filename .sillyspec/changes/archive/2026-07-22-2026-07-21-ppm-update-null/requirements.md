---
author: WhaleFall
created_at: 2026-07-21T12:10:00
---

# 需求（Requirements）— ppm update 清空字段修复

## 功能需求

- **FR-1**：ppm 编辑保存时，用户将字段清空（前端发 null），库中该字段正确落 `null`。
- **FR-2**：用户未提交的字段（前端 omit），库中保持原值（部分更新语义不变）。
- **FR-3**：覆盖 ppm 所有 update 路径——plan/problem `_Crud.update`（里程碑/模块/明细/计划节点/问题/客户/成员/干系人/变更等）+ plan `update_detail`。
- **FR-4**：`change_process`（版本链复制+覆盖）行为不变（null=不覆盖，语义正确）。
- **FR-5**：task update 注释修正为反映实际行为（直接 setattr，未传由 exclude_unset 过滤）。

## 非功能需求

- **NFR-1**：单测覆盖「清空→null」「未传→不动」，覆盖 plan/problem `_Crud.update` + plan `update_detail`。
- **NFR-2**：后端改完 curl 实测 PUT 清空生效（CONVENTIONS 教训：后端必实测）。
- **NFR-3**：无 DB 迁移、无 schema 变更、无 API 契约变更。

## 验收标准

- **AC-1**：编辑里程碑/明细/问题/客户等任一，清空某字段保存 → 刷新后该字段为空，库里为 `null`。
- **AC-2**：编辑时只改某字段不动其他 → 其他字段保持原值。
- **AC-3**：新增单测全绿；既有测试不回归。
- **AC-4**：明细变更流程（change_process）仍正常（复制旧版本字段，不因 null 丢失）。
