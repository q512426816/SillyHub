---
author: qinyi
created_at: 2026-07-24 14:12:57
---

# 提案书（Proposal）— 问题清单导入增强

## 动机

已上线的问题清单 Excel 导入（commit c1d26a00）三点不足：不支持附件、模板静态下拉需手填易错、导出格式与导入不一致无法往返。本次补齐。

## 关键问题（现有方案为何不够）

1. **附件缺失**：原 D-007 决定不导入附件，用户期望 Excel 嵌图片附件（每问题 ≤3 张）。
2. **模板静态**：项目/模块/责任人/验证人/枚举全靠手填，易错（填错靠严格校验标红发现，但源头没限制）。
3. **导出不对齐**：导出列与导入模板不一致，无法「导出→改→导回」批量编辑往返。

## 变更范围

- **附件图片导入**：Excel 嵌图片（openpyxl ws._images 提取 + 锚点关联行）→ 上传 MinIO（upload_file）→ file_id 存 file_urls；每问题 ≤3 张，超额标红；单图失败不中断。
- **动态下拉模板**：新增 GET /problem-list/import-template 端点，后端查系统数据（项目/成员按 data_scope、模块全部平铺）+ 固定枚举 → 生成 Excel 数据有效性下拉。
- **导出对齐**：导出改 18 列对齐导入模板，附件列嵌图片（openpyxl add_image），支持往返。
- **新增 Pillow 依赖**（openpyxl 图像读写必需）。

## 不在范围内（显式清单）

- **不做** Word/PDF 等 OLE 嵌入对象导入（openpyxl 读不了，仅图片）。
- **不做** module 下拉按项目级联（DataValidation 列级静态限制）。
- **不改** file 模块代码（复用 upload_file/get_stream）。
- **不改** 现有 CRUD/3 态执行流/权限/data_scope。

## 成功标准（可验证）

- 导入 Excel 嵌图片（≤3/行）成功上传 MinIO 存 file_id，>3 标红，单图失败计 failed_rows 不中断。
- 下载模板含下拉（项目/成员/模块/枚举），只能选已有。
- 导出 18 列对齐导入模板，附件列嵌图片，导出→改→导回图片 file_id 链不断。
- Pillow 依赖加入 pyproject，backend 重建后图像读写可用。
- 旧功能零回归（backend ppm + frontend vitest 全绿）。
