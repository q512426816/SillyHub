---
author: flow-machine-draft
created_at: 2026-11-02T01:03:45.207Z
---
# 决策记录（Decisions）— 2026-10-31-share-openai-chat-proxy-token

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：llm-proxy 是 master key 唯一注入点（Grill 加固面），新增验签分支若实现有误可能影响生产 GLM 流量。缓解：分支按 Bearer 前缀短路隔离——shlp_ 前缀才进入新代码，生产存量流量（daemon apiKey/JWT）一行不差走旧路径；令牌分支任何失败都 fail-closed（401/403），不放行无主请求；新增用例覆盖篡改/过期/错配三条拒绝路径。次风险：zcode-settings 写盘新字段进入 provider_config.json（0600 会话隔离目录）——与现有明文 api_key 同盘同防护等级，不新增暴露面。死路（已试弃）：让代理改查 DB 做共享判定——Bearer 是 daemon 身份，DB 里没有「这次推理属于哪个会话」的信息，查无可查；这是身份载体问题，必须把会话属主身份随请求带下来。
