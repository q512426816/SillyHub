---
author: flow-machine-draft
created_at: 2026-10-05T17:37:00.168Z
---
# 决策记录（Decisions）— 2026-10-06-opencode-go-direct-anthropic

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：opencode go 端点行为是实测口径（仅认 x-api-key、识别 Claude Code 原生 session 头、全模型可经 /v1/messages 路由），上游未来变更口径（如强制专有 session 头、收敛 /v1/messages 模型面）会使直连失效——缓解：平台探活（GET /zen/go/v1/models）与每次会话请求会立即暴露，届时按报错口径再调整，且此形态与 cc-switch 生态用户同型，上游破坏面大、概率低。放弃的方案：① 修 litellm 换 tag 复活 openai_chat 链——2026-10-05 本地矩阵已证伪无可 pin tag（两个 v1.95.x 变体坏构建、1.96+ anthropic adapter 不认 mode=chat 恒打上游 /responses）；② 注入 x-opencode-session 自定义头——实测 Claude Code 原生 session 头已被识别（官方文档明示 + 真机验证），无需加复杂度；③ opencode_zen_openai 预设（zen 计费）也切直连——该 key 无 zen 余额（实测 Insufficient account funds），且 zen 端点 anthropic 面未验证，留待 litellm 分叉拍板一并处置。
