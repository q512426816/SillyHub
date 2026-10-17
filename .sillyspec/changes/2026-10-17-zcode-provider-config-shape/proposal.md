---
author: flow-machine-draft
created_at: 2026-10-17T03:39:40.718Z
---
# 提案书（Proposal）— 2026-10-17-zcode-provider-config-shape

## 动机

任务原话转写：zcode 引擎会话全挂：注入 provider 配置形状错误致注册表无模型
动机：腾讯云真机实证——zcode 会话创建成功但每轮立即 turn.failed「Select a model before continuing」。三重证据（宿主 provider_config.json 有效形状 / zcode.cjs bundle 内 .strict() schema 与写盘器输出 / daemon.log 三次同错误）钉死根因：zcode-settings.ts 把 providerConfigRules 写成裸数组，而引擎 schema 要求 {providerRules:[...]} 对象包裹（附 modelConfigRules 两键），注入文件被引擎静默丢弃；叠加 _applyModel 目录等待超时/精确命中路径 resolvedModelId 保持 undefined，把 modelId:undefined 发给 setModel 必败。inject→inputQueue→驱动消费链路经 dl-out.log 实证无问题（368a0ed6 会话 inject 缓冲+消费正常），无需加验证日志。

成功标准：
- buildZcodeProviderConfig 输出形状与宿主有效配置一致（providerConfigRules:{providerRules:[...]} + modelConfigRules:{providerModelRules:[],manualProviderModelRules:[]}），单测钉形状
- _applyModel 三路径（精确命中/大小写命中/超时回退）均发送字符串 modelId，单测钉超时回退路径
- 单测全绿（zcode-settings + zcode driver 相关）
- 重建 bundle 安装到本机 daemon 并重启，生产后端实测：新建 zcode 会话发一轮消息，turn 完成、回复落库渲染、模型路由走 SillyHub provider（daemon.log 无 Provider Registry/Select a model 错误）

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. buildZcodeProviderConfig 输出形状与宿主有效配置一致（providerConfigRules:{providerRules:[...]} + modelConfigRules:{providerModelRules:[],manualProviderModelRules:[]}），单测钉形状
2. _applyModel 三路径（精确命中/大小写命中/超时回退）均发送字符串 modelId，单测钉超时回退路径
3. 单测全绿（zcode-settings + zcode driver 相关）
4. 重建 bundle 安装到本机 daemon 并重启，生产后端实测：新建 zcode 会话发一轮消息，turn 完成、回复落库渲染、模型路由走 SillyHub provider（daemon.log 无 Provider Registry/Select a model 错误）

## 成功标准（可验证）

1. buildZcodeProviderConfig 输出形状与宿主有效配置一致（providerConfigRules:{providerRules:[...]} + modelConfigRules:{providerModelRules:[],manualProviderModelRules:[]}），单测钉形状
2. _applyModel 三路径（精确命中/大小写命中/超时回退）均发送字符串 modelId，单测钉超时回退路径
3. 单测全绿（zcode-settings + zcode driver 相关）
4. 重建 bundle 安装到本机 daemon 并重启，生产后端实测：新建 zcode 会话发一轮消息，turn 完成、回复落库渲染、模型路由走 SillyHub provider（daemon.log 无 Provider Registry/Select a model 错误）
