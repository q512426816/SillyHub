---
author: flow-machine-draft
created_at: 2026-10-04T15:28:14.711Z
---
# 需求规格（Requirements）— 2026-10-04-handoff-op-detail

## 功能需求

> FR 由你撰写：每条 = `### FR-NN: 标题` + 一句带强度词的行为规定（必须=硬性；禁止=红线；
> SHOULD=建议须注理由；可以=可选）；边界情形加场景块 `#### 场景：名` + Given/When/Then 行。
> 标题行是成功标准锚（勿改写——收口做门柱对比）；正文与场景块归你。

### FR-01: 最近操作行携带紧凑摘要：路径类工具显示入参 path 类字段值、Bash 显示 command 首段，均截 120 字符；无可用摘要时维持纯工具名

- 必须：tool_use 操作行格式为 `- 工具名：摘要`，摘要取 path 类字段值优先、无则 command；折行压平并截 120 字符；两类键均无命中时必须退回纯 `- 工具名` 行（禁止出现悬空冒号）。

#### 场景：主路径

Given 带完整 tool_input 的 Read/Bash tool_use 段与无 tool_input 的 tool_use 段 / When 组装交接文档 / Then 前两者行内分别含路径与命令摘要（120 截断），后者为纯工具名。

### FR-02: 摘要提取复用 tool_input JSON 解析链（含截断坏 JSON regex 兜底），涉及文件节与操作行共用同一提取逻辑不漂移

- 必须：涉及文件节与操作行摘要走同一提取函数（`_tool_input_field`），禁止两处各自解析造成口径漂移；截断坏 JSON 的 regex 兜底对两组键同样生效。

#### 场景：主路径

Given tool_input 为 2KB 截断坏 JSON 且 path/command 键在截断点前 / When 提取 / Then 涉及文件与操作摘要均能取到同一值。

### FR-03: 失败标记（失败）仍回贴在行尾

- 必须：tool_result 携带 is_error 时「（失败）」回贴在对应操作行行尾（摘要之后），配对键 tool_use_id 语义不变。

#### 场景：主路径

Given tool_use（带摘要）+ 同 tool_use_id 的 is_error tool_result / When 组装 / Then 操作行为 `- 工具名：摘要（失败）`。

### FR-04: 测试覆盖路径/命令/无摘要三形态，takeover+handoff 测试全绿

- 必须：测试覆盖路径摘要/命令摘要/无摘要纯工具名三形态与 120 截断、失败回贴行尾；test_takeover_handoff.py 与 test_takeover.py 全量绿。

#### 场景：主路径

Given 更新后的 handoff 测试 / When 全量执行 / Then 26 用例全绿。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/backend/app/modules/daemon/tests/test_takeover_handoff.py「TestBuildHandoffPrompt::test_sections_and_dedup」
FR-02: test/backend/app/modules/daemon/tests/test_takeover_handoff.py「TestBuildHandoffPrompt::test_truncated_tool_input_regex_fallback」+「test_sections_and_dedup」
FR-03: test/backend/app/modules/daemon/tests/test_takeover_handoff.py「TestBuildHandoffPrompt::test_sections_and_dedup」（- Edit：C:/a/login.py（失败）断言）
FR-04: test/backend/app/modules/daemon/tests/test_takeover_handoff.py 全量 7 用例 + test_takeover.py 19 用例绿
