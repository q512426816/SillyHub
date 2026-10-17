---
author: flow-machine-draft
created_at: 2026-10-17T07:57:35.098Z
---
# 任务注册表（Tasks）— 2026-10-17-dsh-rc2-protocol-fix

- [x] task-01: session/new 恒带 mcpServers:[] 占位（rc.2 必填、旧版兼容），探针验证握手通过
- [x] task-02: set_config_option 改扁平形状（configId=model/reasoning_effort），设置失败降级 warn 非致命（不再杀会话），单测钉新形状
- [x] task-03: 驱动失败路径留痕：握手里程碑、consume failed 原因、子进程退出，daemon.log 可见
- [x] task-04: dsh 驱动相关单测全绿（15 用例）；typecheck 干净
