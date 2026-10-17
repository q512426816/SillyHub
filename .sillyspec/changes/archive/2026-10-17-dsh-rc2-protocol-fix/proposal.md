---
author: flow-machine-draft
created_at: 2026-10-17T07:57:35.097Z
---
# 提案书（Proposal）— 2026-10-17-dsh-rc2-protocol-fix

## 动机

任务原话转写：dsh rc.2 协议断裂修复——会话 3 秒静默死两连
动机：本机 dsh 今日 00:17 自动更新至 0.2.0-rc.2（npm latest，alpha 通道风险 R-01 兑现），两处协议破坏性变更叠加致所有 dsh 会话 ready 后 ~3 秒静默终止（今日 9 次 killed 全中）：① session/new 新增必填 mcpServers（缺失回 -32602 Invalid params）；② set_config_option 参数改扁平 {sessionId, configId, value}（官方 @agentclientprotocol/sdk v2 schema，旧嵌套 {option:{optionId,value}} 被拒）。另：驱动失败路径此前零日志（静默死无法定位），本次补里程碑/错误/子进程退出留痕。UI 真机复现三连（14:59 用户会话 / 15:22 我方 UI 会话 / 15:46 修复中会话）+ ACP 手动探针双轮钉死形状。

成功标准：
- session/new 恒带 mcpServers:[] 占位（rc.2 必填、旧版兼容），探针验证握手通过
- set_config_option 改扁平形状（configId=model/reasoning_effort），设置失败降级 warn 非致命（不再杀会话），单测钉新形状
- 驱动失败路径留痕：握手里程碑、consume failed 原因、子进程退出，daemon.log 可见
- dsh 驱动相关单测全绿（15 用例）；typecheck 干净

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. session/new 恒带 mcpServers:[] 占位（rc.2 必填、旧版兼容），探针验证握手通过
2. set_config_option 改扁平形状（configId=model/reasoning_effort），设置失败降级 warn 非致命（不再杀会话），单测钉新形状
3. 驱动失败路径留痕：握手里程碑、consume failed 原因、子进程退出，daemon.log 可见
4. dsh 驱动相关单测全绿（15 用例）；typecheck 干净

## 成功标准（可验证）

1. session/new 恒带 mcpServers:[] 占位（rc.2 必填、旧版兼容），探针验证握手通过
2. set_config_option 改扁平形状（configId=model/reasoning_effort），设置失败降级 warn 非致命（不再杀会话），单测钉新形状
3. 驱动失败路径留痕：握手里程碑、consume failed 原因、子进程退出，daemon.log 可见
4. dsh 驱动相关单测全绿（15 用例）；typecheck 干净
