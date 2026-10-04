---
author: flow-machine-draft
created_at: 2026-10-04T15:28:14.711Z
---
# 设计记录（Design Record）— 2026-10-04-handoff-op-detail

> 四节每节必答——答案直接写在问题下方；小改动可写「不适用：<理由>」；flow done 空节拒收。
> 需要列改动文件时在「接口契约」节加「文件变更清单」表（| 新增/修改 | 路径 | 说明 |）。

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

把 2026-10-04-handoff-doc-kind-contract 引入的 `_collect_tool_files`（单用途：path 类键提取进涉及文件节）泛化为 `_tool_input_field(tool_input, keys)`——键组参数化（`_TOOL_FILE_KEYS` / `_TOOL_COMMAND_KEYS`），涉及文件节与最近操作行共用同一提取函数（json.loads 完整解析 + 截断坏 JSON 键名 regex 兜底 + dict 兼容，反转义共用 `_unescape_json_string`）。最近操作行从纯 `- 工具名` 升级为 `- 工具名：摘要`：path 类字段值优先（文件工具）、无则 command（Bash 类），折行压平截 120；两类键均无命中退回纯工具名。选共用函数而非操作行再写一套解析：同一 tool_input 两处口径必须一致，否则文件节有路径而操作行无摘要（或反之）这种漂移比没有摘要更误导。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

`build_handoff_prompt` 签名不变（纯函数）；行为变化=最近操作节每行可携带摘要（path/command 类，压平截 120），失败标记仍回贴行尾。内部：`_collect_tool_files` 删除、新增 `_tool_input_field` / `_unescape_json_string`、常量 `_TOOL_COMMAND_KEYS`。HTTP 端点签名无变化。

文件变更清单：

| 新增/修改 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/session/service/takeover.py | 提取函数泛化 + 操作行摘要 |
| 修改 | backend/app/modules/daemon/tests/test_takeover_handoff.py | 摘要/无摘要/截断/失败回贴断言 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：与上一变更同构——messages 是 seq 有序窗口，逐段独立提取，无跨段状态（除 tool_use_id 回贴表，语义不变）；乱序不影响摘要提取正确性。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：不适用：纯函数零共享状态零 IO，无并发写面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：不适用：与既有 handoff 链一致——文档一次性注入新会话首 prompt，源会话零写红线不变。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不适用：摘要提取作用于单条消息的 tool_input，无跨会话/跨工作区数据面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：regex 兜底从截断 JSON 取 command 时，命令值本身被 2KB 截断切断会得到半截命令进操作行（展示性，同上一变更已披露的半截路径边界；不参与匹配/写库）。120 字符截断已把该噪声压到一行内。试过放弃的方案：操作行带完整 tool_input JSON——2KB/条的原始入参让 8 行操作节膨胀到淹没对话节，且大量与涉及文件节重复；摘要（单字段值）信息密度/噪声比最优，故弃。
