---
author: flow-machine-draft
created_at: 2026-10-22T02:16:34.210Z
---
# 需求规格（Requirements）— 2026-10-22-fix-translate-cjk-segments

## 功能需求

### FR-01: 送翻前必须对每个正文段做段级判定，中文为主的段禁止送模型

- 保护切分后的每个 `translatable` 正文段必须在送翻前经过段级判定：中文占比 ≥0.6 的段必须原样保留、禁止进入送翻队列；段级判定只判语言倾向，禁止套用整条的「最短 30 字符 / 最少 8 拉丁字母」长度阈值（否则短英文段会被漏翻）。

#### 场景：中文正文 + 英文代码块

- Given 思考内容为「中文正文 + 围栏代码块」
- When 整条通过「值得翻」判定后进入分段送翻
- Then 代码块原样保留（既有保护），中文正文段原样保留，零推理调用

#### 场景：短英文段不被漏翻

- Given 段内容为 `Run this first:`（短于 30 字符、含拉丁字母）
- When 段级判定执行
- Then 判定为需要翻译并正常送翻（段级不适用长度阈值）

### FR-02: translated 标记必须反映实际送翻动作

- `translated` 字段必须为 true 仅当该条至少有一个块实际送翻（含缓存命中回填）；全部正文段被段级判定跳过时必须返回 `translated=false`，禁止仅凭「整条判定通过」置真。

#### 场景：全部段跳过

- Given 整条通过 worthy 判定但所有正文段均为中文为主
- When 重组响应
- Then `translated=false` 且文本等于原文

### FR-03: 混合内容与纯英文内容行为正确

- 中文正文 + 英文代码块必须返回原文且 `translated=false`；纯英文内容（含代码块/URL）必须仍正常翻译，保护段原样、正文段译文按序回填。

#### 场景：纯英文回归

- Given 全英文正文与代码块混合的思考内容
- When 翻译执行
- Then 所有保护段原样、所有英文正文段送翻并回填，行为与修复前一致

### FR-04: 相关测试必须通过

- 后端 translate 模块测试必须全绿，新增用例覆盖段级判定（中文段跳过、短英文段送翻）、混合内容 `translated=false`、纯英文回归。

#### 场景：主路径

- Given 代码与用例落盘
- When 运行 `pytest app/modules/translate/tests`
- Then 全部通过

## 测试绑定

FR-01: backend/app/modules/translate/tests/test_chunking.py「should_translate_segment 段级判定（中文为主跳过 / 短英文段送翻）」
FR-02: backend/app/modules/translate/tests/test_service.py「全部正文段被跳过 → translated=false」
FR-03: backend/app/modules/translate/tests/test_service.py「中文正文+代码块返回原文；纯英文保护段回归」
FR-04: 不适用：本条本身即测试执行要求，由 flow done 实测门对账
