---
id: task-01
title: Add Pillow dependency + spike image read/write
title_zh: pyproject 加 Pillow>=10 + spike 验证 openpyxl 图像读写
author: qinyi
created_at: 2026-07-24 14:20:00
priority: P0
depends_on: []
blocks: [task-02, task-05]
requirement_ids: [FR-09]
decision_ids: [D-008@v1]
allowed_paths:
  - backend/pyproject.toml
  - backend/uv.lock
provides:
  - contract: Pillow_available
    fields: []
expects_from: {}
goal: >
  补 openpyxl 图像读写必需的 Pillow 依赖，并 spike 验证 ws._images 读 + add_image 写两端可用（grill B-001 P0）。
implementation:
  - backend/pyproject.toml dependency groups 加 Pillow>=10
  - spike：临时脚本 load_workbook(含图xlsx) 读 ws._images 取 bytes + Workbook add_image 写，验证两端无 ImportError（PIL 可用）
  - uv sync 装依赖
acceptance:
  - pyproject.toml 含 Pillow>=10
  - spike 两端（读 ws._images + add_image）成功（PIL 可用）
verify:
  - cd backend && uv sync --all-extras
  - cd backend && uv run python -c "from openpyxl import Workbook; from openpyxl.drawing.image import Image; import PIL; print('OK')"
constraints:
  - 不改其他依赖
  - spike 脚本临时（验证后删）
---

# task-01 — pyproject 加 Pillow>=10 + spike 验证 openpyxl 图像读写

## 背景
design §5.0 + §10 R-06 + 决策 D-008（grill B-001 P0）：openpyxl 的 `ws._images` 读与 `add_image` 写都强依赖 PIL，spike 实测无 PIL 时 `_import_image` 抛 ImportError。
本变更新增图片附件导入/导出（task-02 读端、task-05 写端），必须先补 Pillow 并验证两端可用，否则后续图片读写推翻重设计（plan Spike 前置 spike-01）。

## 现状
`backend/pyproject.toml` `[project] dependencies`（L7-28）已有 `openpyxl>=3.1`（L23），**无 Pillow**；dev 组（L30-42 / L95-101）也无，本次只在 dependencies 加一行。

## 改动（仅 pyproject.toml + 临时 spike 脚本）
1. `[project] dependencies` 在 `openpyxl>=3.1` 行后追加：
   `Pillow>=10`  # openpyxl 图像读写必需（ws._images 读 + add_image 写），D-008
2. `cd backend && uv sync --all-extras` 装依赖。
3. spike 临时脚本（放系统临时目录，验证后删）：
   - **读端**：`load_workbook(含图 xlsx)` → 遍历 `ws._images` → `img._data()` 取 bytes + `img.anchor._from.row`。
   - **写端**：`Workbook()` → `ws.add_image(Image(BytesIO(png)), "A1")` → save → reload 验证 `ws._images` 非空。
   - 两端都不得抛 ImportError（即 PIL 可用）。

## 验收
- `pyproject.toml` dependencies 含 `Pillow>=10`（紧跟 openpyxl）。
- `uv sync` 成功安装 Pillow。
- spike 读端 + 写端均成功，无 ImportError；spike 脚本已删除不入库。

## 验证命令
- `cd backend && uv sync --all-extras`
- `cd backend && uv run python -c "from openpyxl import Workbook; from openpyxl.drawing.image import Image; import PIL; print('OK')"`

## 约束
- 只改 `backend/pyproject.toml`（加一行依赖），不动其他依赖版本、不动 dev 组。
- spike 脚本临时，验证后删除不提交；不动 importer/router/service（task-02/04/05 职责）。

## 依赖与阻塞
- depends_on: []（Wave1 第 0 步，无前置）。
- blocks: [task-02, task-05]（图片读写两端依赖 PIL 可用，契约 Pillow_available）。
