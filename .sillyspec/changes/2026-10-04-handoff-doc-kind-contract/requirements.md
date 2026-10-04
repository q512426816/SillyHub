---
author: flow-machine-draft
created_at: 2026-10-04T14:48:49.718Z
---
# 需求规格（Requirements）— 2026-10-04-handoff-doc-kind-contract

## 功能需求

> FR 由你撰写：每条 = `### FR-NN: 标题` + 一句带强度词的行为规定（必须=硬性；禁止=红线；
> SHOULD=建议须注理由；可以=可选）；边界情形加场景块 `#### 场景：名` + Given/When/Then 行。
> 标题行是成功标准锚（勿改写——收口做门柱对比）；正文与场景块归你。

### FR-01: build_handoff_prompt 按 kind 五值契约组装：user_input（sender=system_event 跳过）→ 用户行、reply → 助手行（500 截断）、thinking 跳过、tool_use → 操作行+文件提取、tool_result 失败标记回贴配对 tool_use

- 必须：build_handoff_prompt 只按 NormalizedLogMessage 契约五值 kind（user_input/reply/thinking/tool_use/tool_result）组装分支；禁止再依赖契约外 kind 值（如 user/assistant）判定对话行。

#### 场景：主路径

Given 含真人 user_input、reply、system_event 伪用户、thinking、tool_use、失败 tool_result 的归一化消息窗口 / When 组装交接文档 / Then 用户/助手行成对出现、系统注入与 thinking 不出现、操作行带「（失败）」回贴。

### FR-02: tool_input 兼容 JSON 字符串（含 2KB 截断致 json 解析失败的 regex 兜底）与 dict 双形态，涉及文件节真实数据可产出

- 必须：涉及文件提取接受契约的 JSON 字符串摘要（json.loads）与 dict 双形态；截断坏 JSON 必须 regex 兜底取首个 path 类键（含 JSON 转义反转义），无命中静默省略该节。

#### 场景：主路径

Given tool_use 段 tool_input 为 2KB 截断的坏 JSON 字符串（path 类键在截断点前）/ When 提取涉及文件 / Then 路径仍进入涉及文件节且转义正确反转义。

### FR-03: _build_handoff_first_prompt 的 cwd 会话行优先、空则回退所选 entry 的 agent_cwd（与 tier3 同口径）

- 必须：交接文档工作目录取「会话行 cwd 优先、空则所选主日志 entry 的 agent_cwd」；两者皆空回落 unknown 展示。

#### 场景：主路径

Given 会话行 cwd 为空且所选 entry 带 agent_cwd / When RPC parsed 组装交接文档 / Then 文档「工作目录」显示 entry 的 agent_cwd 而非 unknown。

### FR-04: 测试改用真实契约消息形态，覆盖 system_event 跳过/失败回贴/截断 JSON 兜底/cwd 回退，takeover+handoff 相关测试全绿

- 必须：handoff 相关测试的消息 fixture 使用契约五值 kind 与 JSON 字符串 tool_input（禁止伪造 user/assistant/dict 形态掩盖契约漂移）；覆盖四类边界（system_event 跳过/失败回贴/截断兜底/cwd 回退）。

#### 场景：主路径

Given test_takeover_handoff.py 与 test_takeover.py / When 全量执行 / Then 26 用例全绿。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/backend/app/modules/daemon/tests/test_takeover_handoff.py「TestBuildHandoffPrompt::test_sections_and_dedup」
FR-02: test/backend/app/modules/daemon/tests/test_takeover_handoff.py「TestBuildHandoffPrompt::test_truncated_tool_input_regex_fallback」+「test_sections_and_dedup」
FR-03: test/backend/app/modules/daemon/tests/test_takeover_handoff.py「TestHandoffEndToEnd::test_handoff_doc_injected」（session_cwd="" 断言工作目录回退）
FR-04: test/backend/app/modules/daemon/tests/test_takeover_handoff.py 全量 7 用例 + test_takeover.py 19 用例绿
