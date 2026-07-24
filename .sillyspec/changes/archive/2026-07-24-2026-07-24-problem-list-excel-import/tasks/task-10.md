---
id: task-10
title: Add static import template xlsx
title_zh: 新增 frontend/public/templates/problem-import-template.xlsx 静态模板
author: qinyi
created_at: 2026-07-24 09:53:47
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1, D-009@v1]
allowed_paths:
  - frontend/public/templates/problem-import-template.xlsx
provides: []
expects_from: {}
goal: >
  生成 17 列全字段中文表头 + 1 行示例的静态 .xlsx 模板，供「下载导入模板」按钮分发。
implementation:
  - 用一次性 openpyxl 脚本（本地临时跑，不入库）生成 .xlsx：表头行=项目名称/模块名称/问题描述/问题类型/是否加急/功能名称/责任人/发现人/发现时间/计划开始/计划结束/验证人/工作量(人天)/工作类型/问题答复/是否延期计划/备注；首行示例数据（如：转向架项目/构架/焊缝裂纹/bug/否/制动/张三/王五/2026-08-01/2026-08-01/2026-08-10/李四/2/开发//否/）
  - 表头样式对齐 common/export.py（深蓝底白字 bold，冻结首行）
  - 保存到 frontend/public/templates/problem-import-template.xlsx
  - 「是否加急/是否延期计划」示例用「是/否」，与 importer 规范化一致
acceptance:
  - 模板文件存在于 public/templates/
  - 17 列中文表头齐全
  - 含 1 行示例
verify:
  - ls frontend/public/templates/problem-import-template.xlsx
  - 手动 openpyxl 读回校验表头列名
constraints:
  - 模板是静态文件（Next.js public 静态服务），不动态生成
  - 列顺序与 importer 按表头文字定位无关（importer 容错），但仍按设计清单顺序
---

# TaskCard — 静态导入模板 xlsx

## 目标
产出问题清单 Excel 批量导入用的标准模板 `frontend/public/templates/problem-import-template.xlsx`：17 列全字段中文表头 + 1 行示例数据，表头样式与导出风格一致。前端 task-08 弹窗的「下载导入模板」按钮直接以静态 URL（`/templates/problem-import-template.xlsx`）分发，无需后端动态生成。

## 依据
- design.md §5 Wave2 step5（模板静态 17 列中文表头 + 1 行示例）、§7 DTO 字段顺序、§9 兼容策略（纯新增静态文件，零回归）。
- plan.md task-10：覆盖 FR-01（模板下载入口）；D-003@v1（17 列全字段清单）；D-009@v1（必填=项目名称+问题描述，示例行两项均填）。
- 原型 `prototype-problem-import.html`「导入模板列（全字段）」表：列名 / 说明 / 匹配规则三列定义齐全，是表头文字唯一来源。
- 放置范式：`frontend/public/templates/dev-plan-template.xlsx`（项目计划导入模板，612KB），`public/templates/` 目录即静态模板约定位置，Next.js 直接静态服务。
- 表头样式范式：`backend/app/modules/ppm/common/export.py` `rows_to_workbook`（`_HEADER_FILL=#305496` 深蓝底、`_HEADER_FONT` 白字 bold、`freeze_panes="A2"` 冻结首行）。

## 实现步骤
1. 本地写一次性 openpyxl 脚本（不入库，跑完即弃）：新建 `Workbook`，`ws.append(headers)` 写 17 列表头。
2. 表头样式对齐 export.py：每个表头单元格 `Font(bold=True, color="FFFFFF")` + `PatternFill(start_color="305496", end_color="305496", fill_type="solid")` + 居中；`ws.freeze_panes = "A2"` 冻结首行；按列内容给合理列宽。
3. 第 2 行写 1 行示例（必填项不可空）：`转向架项目 | 构架 | 焊缝裂纹 | bug | 否 | 制动 | 张三 | 王五 | 2026-08-01 | 2026-08-01 | 2026-08-10 | 李四 | 2 | 开发 | （空）| 否 | （空）`。
4. 日期单元格写 `datetime.date` 对象（非字符串），importer 的 Excel 序列号→date 路径才走得通。
5. 「是否加急/是否延期计划」示例值用中文「是/否」（与 importer 枚举规范化输入一致，importer 转 `"1"/"0"`）。
6. `wb.save` 输出到 `frontend/public/templates/problem-import-template.xlsx`。

## 验收
- `frontend/public/templates/problem-import-template.xlsx` 文件存在（非空）。
- 用 openpyxl 读回：第 1 行 17 列表头文字与设计清单完全一致、顺序一致；第 2 行示例数据齐全且「项目名称/问题描述」非空。
- 表头单元格 fill=#305496、font bold 白字、freeze_panes=A2。
- 前端构建后 `GET /templates/problem-import-template.xlsx` 可直接下载（Next.js public 静态服务，无需路由）。

## 约束
- 模板是静态产物，不接后端动态生成端点（D-003 全字段 + 严格校验已够，非目标「不做动态下拉模板」）。
- 生成脚本不入库（一次性），只提交 .xlsx 二进制产物到 `allowed_paths`。
- 列顺序按设计清单顺序写；importer 按表头文字定位列、对顺序容错（R-04），但模板仍以设计清单顺序为准，避免用户困惑。
- 必填维度只示范「项目名称+问题描述」非空（D-009），其余选填项示例可空，不得在模板里暗示更多必填。
