---
author: flow-machine-draft
created_at: 2026-10-22T02:40:09.618Z
---
# 需求规格（Requirements）— 2026-10-22-protect-cjk-source

## 功能需求

### FR-01: 源端中文片段必须作为保护段原样保留

- `split_protected` 必须把源端连续中文片段（汉字 U+3400–4DBF / U+4E00–9FFF 与中文及全角标点 U+3000–303F / U+FF00–FFEF）切为保护段（`translatable=False`），禁止进入送翻文本；围栏代码 / 行内代码 / URL 的既有保护与正文切分语义必须不变。

#### 场景：英文句子夹中文引用

- Given 英文思考内容包含 `"合并键应该是工区不是厂房"` 这类中文引用
- When 保护切分执行
- Then 中文引用整体进入保护段、不进入送翻块，英文正文仍为正文段

#### 场景：纯英文内容不变

- Given 全英文文本（含代码块 / 行内代码 / URL）
- When 保护切分执行
- Then 保护段与正文段划分与修复前一致（无中文分支参与）

### FR-02: 含中文引用的内容禁止出现反斜杠乱码

- 含中文引用的英文思考内容经翻译后，译文禁止出现连续反斜杠（≥3 个 `\`）乱码，中文引用必须逐字保留在输出中。

#### 场景：生产复现文本

- Given 生产复现的英文思考内容（含多处中文引用）
- When 送翻并重组
- Then 输出包含原文每一处中文引用，且不含连续反斜杠乱码

### FR-03: 纯英文翻译行为不回退

- 纯英文内容必须仍正常翻译：保护段原样、英文正文送翻并按序回填，`translated=true`。

#### 场景：纯英文回归

- Given `Run this first:\n\`\`\`\nls -la\n\`\`\`\nthen read https://example.com/x for details.`
- When 翻译执行
- Then 保护段原样、正文段译文按序回填（与既有断言一致）

### FR-04: 相关测试必须通过

- 后端 translate 模块测试必须全绿，新增用例覆盖中文片段保护切分、中文引用保留与无反斜杠乱码。

#### 场景：主路径

- Given 代码与用例落盘
- When 运行 `pytest app/modules/translate/tests`
- Then 全部通过

## 测试绑定

FR-01: backend/app/modules/translate/tests/test_chunking.py「中文片段切为保护段且正文英译不变」
FR-02: backend/app/modules/translate/tests/test_service.py「中文引用原样保留且输出无反斜杠乱码」
FR-03: backend/app/modules/translate/tests/test_service.py「纯英文保护段回归（既有用例）」
FR-04: 不适用：本条本身即测试执行要求，由 flow done 实测门对账
