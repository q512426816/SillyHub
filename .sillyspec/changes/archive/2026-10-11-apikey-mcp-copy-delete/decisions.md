---
author: flow-machine-draft
created_at: 2026-10-11T08:01:18.979Z
---
# 决策记录（Decisions）— 2026-10-11-apikey-mcp-copy-delete

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：**可逆存储是安全降级**——DB 全量泄露 + KEK 同时泄露时凭据直接暴露（原 bcrypt 方案下不可能）。接受理由：内部平台、用户明确要求列表可复制；缓解措施是密文落库（DB 备份/ 日志拖库单独不构成泄露）+ KEK 走环境变量与 DB 分离，与 mcp_webhooks.secret 既有风险面 持平。 试过放弃的方案：(a) 明文直接入库——放弃，密文列成本极低而拖库面显著恶化；(b) 每次「复制」 都新建 key（保持 hash-only 模型）——放弃，key 会随复制次数无限堆积，且「列表复制已生成 凭据」的需求语义不符；(c) 单独 `POST .../purge` 端点——放弃，`?hard=true` 查询参数复用 既有 DELETE 路由与权限门，改动面更小。
