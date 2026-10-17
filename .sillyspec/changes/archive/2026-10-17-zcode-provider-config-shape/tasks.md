---
author: flow-machine-draft
created_at: 2026-10-17T03:39:40.718Z
---
# 任务注册表（Tasks）— 2026-10-17-zcode-provider-config-shape

- [x] task-01: buildZcodeProviderConfig 输出形状与宿主有效配置一致（providerConfigRules:{providerRules:[...]} + modelConfigRules:{providerModelRules:[],manualProviderModelRules:[]}），单测钉形状
- [x] task-02: _applyModel 三路径（精确命中/大小写命中/超时回退）均发送字符串 modelId；目录命中附带 options.reasoningLevel（引擎自报 defaultLevel ?? 末档），目录等待窗 15s→60s
- [x] task-03: 单测全绿（zcode-settings 10 + zcode-app-server-driver 20 + zcode-events 14 = 44 用例）+ typecheck 干净
- [x] task-04: 重建 bundle 安装本机 daemon 并重启，生产实测 zcode 三轮（687ac4e1/1d9ebb72/ae34976e run completed、exit 0、路由 provider 正确、零错误日志）+ dsh 一轮（9e4d4989 completed）——inject→inputQueue 链路经 dl-out.log 实证无需加验证日志
