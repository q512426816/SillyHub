---
author: qinyi
created_at: 2026-09-11 21:30:00
---
# 提案书（Proposal）

## 动机
技能库/MCP 资产库（user 维度）与 workspace 层管理面互不知晓（用户在 workspace skills 页发现无关联）：git 技能无法按 workspace 启用、MCP 资产库无法下发到 .mcp.json、specDir 散技能无法收编。
## 关键问题
1. 桥①②：workspace 维度技能启用落库后无注入通道（daemon manifest 无 workspace 上下文——Grill B-01）
2. 桥③：资产库到 .mcp.json 无桥（手工抄 JSON）
3. 桥④：specDir 技能与平台库名两套白名单字符集不兼容（Grill B-02）
## 变更范围
- user_skill_enables 单表双 scope（workspace_id 列+双 partial）+ bundle 并集查询（D-002/D-003/D-010）
- daemon per-workspace manifest 最小改造（D-007：槽位隔离+按会话选槽）
- MCP import-from-registry 端点（D-004/D-009）+ specDir 收编两端点（D-005/D-008）
- 前端两页区块
## 不在范围内
- workspace 维度 MCP 绑定进 platform_default / 多文件收编 / daemon 分发架构深化（槽位模式外的命名空间方案）
## 成功标准
- workspace 启用 git 技能→该 workspace 会话 bundle 实际包含（daemon 链路真注入）；user 维度 version hash 零变化
- import 后 .mcp.json 含该 server（含解密 env）；adopt 后 CustomSkill 可用且重名 409
