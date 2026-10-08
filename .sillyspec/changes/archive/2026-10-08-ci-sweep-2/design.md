---
author: flow-machine-draft
created_at: 2026-10-08T15:12:55.373Z
---
# 设计记录（Design Record）— 2026-10-08-ci-sweep-2

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

2026-10-08 新提交上三线 CI 共 8 用例失败，逐一核对生产意图后确认全部为测试侧未跟上近期有意生产变更（生产代码零行改动）：①frontend git-log-page.test 钉 TABS=15，e8da254ce 知识图谱变更插入第 16 个页签（其自身 workspace-tabs.test 已更新，此数量钉漏跟）——改 16 并同步用例名/头注释；②backend test_cleanup_stale_runs_error_code 钉旧 error_detail 文案，9f1f974c4/89a7e9a42 宽限窗变更经评审 P3 有意改文案（reason 兼顾复扫场景、finished_by=stale_run_cleanup，生产注释明载）——期望改新文案并注释溯源；③daemon 心跳平铺形态 d6fabf408 加 machine-id 尾参后 10→11，daemon-heartbeat-pending/sillyspec 两文件已同步改 11，sillyspec-platform-command 6 处与 selfupdate-scenarios 2 处漏跟——补改并带同款尾参注释；④daemon provider-adapter-registry 对账正则锚单数 agent_kind 冒号形态，2026-10-06-provider-multi-agent-kind 把字段改复数 agent_kinds list Literal 致解析失配（防哑绿抛「锚点漂移」）——正则随形态更新，注释锚同步。修测试而非回退生产：四处生产变更均有变更档案与评审留痕，属规则 9 允许的测试过时情形。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无——纯测试侧断言/解析器对齐，生产代码零行改动。涉及对齐的既有契约：WorkspaceTabs 16 键注册表、_cleanup_stale_runs_impl error_detail 新文案、daemon heartbeat 11 参平铺形态、backend llm_provider schema agent_kinds 复数词表。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用——静态断言对齐，无事件序参与；心跳 11 参长度断言与传参顺序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用——单仓测试文件改动，无共享可变状态。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

不适用——无运行时行为变化。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不适用——provider-adapter-registry 对账正则读主仓 backend schema 源（CI 与本地同路径解析，已实证两边一致）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：正则锚未来再随 schema 形态演化漂移——防哑绿抛错语义保留（失配即响亮失败），漂移会被即时暴露而非静默通过。放弃方案：回退四处生产变更让测试通过——放弃，均有变更档案/评审留痕的有意行为，回退等于推翻已验收功能；改用运行时 import 跨语言读词表——放弃，TS 无法 import Python 源，源文件读取式解析即先例形态。
