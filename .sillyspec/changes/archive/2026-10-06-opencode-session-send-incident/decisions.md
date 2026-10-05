---
author: flow-machine-draft
created_at: 2026-10-05T23:35:26.895Z
---
# 决策记录（Decisions）— 2026-10-06-opencode-session-send-incident

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：①HTTPS_PROXY 绑定 daemon 本机代理端口（127.0.0.1:7897）——换机器/换端口失效，属环境耦合（notes 已注明，探活与会话报错即时暴露）；②上游网络环境变化（劫持消失/代理下线）时该 env 变冗余但无害（代理拒连才会断，可再清）。放弃的方案：①把 isToolReportBody 判定内联进 handleSend（session?.origin === ...）——治标不治本，渲染区 6 处消费点仍需变量，双源漂移；②在 llm-proxy（hub 服务器侧转发）承载 opencode 流量借服务器干净网络——那是 openai_chat 的 LiteLLM 路径，anthropic 直连形态无此通道，为绕网络劫持重开转换网关属方向性倒退（litellm 分叉仍未拍板）；③给 daemon 全局配代理——影响所有供应商（国内上游走代理反而劣化），per-provider extra_env 是正确粒度。
