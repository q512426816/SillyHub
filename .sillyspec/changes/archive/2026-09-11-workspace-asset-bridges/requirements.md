---
author: qinyi
created_at: 2026-09-11 21:30:00
---
# 需求规格（Requirements）

## 角色
admin（配 git 源）/ workspace 成员（workspace 维度启用/导入/收编）/ 普通用户（user 维度沿用）/ daemon（per-workspace 拉取）

## 功能需求
### FR-01: workspace 维度技能启用与并集注入
覆盖：D-002/D-003/D-007/D-010
Given git 技能在库且 workspace 成员启用（workspace_id 行）
When 该 workspace 的会话/任务拉 bundle
Then manifest(?workspace_id) 返回 user∪workspace 并集；daemon per-workspace 槽分发，workdir 含并集 git 技能；user 维度（无 ws 上下文）bundle version hash 与现状一致

### FR-02: MCP 资产库选入 workspace
覆盖：D-004/D-009
Given 平台库 server（可见性校验：跨用户私有 404）
When 成员 POST import-from-registry
Then .mcp.json 合入该 server（解密 env 明文写入，同名改名 -registry）；解密失败 422；registry 状态零变化

### FR-03: specDir 收编
覆盖：D-005/D-008
Given workspace skills 页触发 adoptable
Then 差集列表（排 CustomSkill 全体∪sillyspec-*∪git discover 全 enabled 源）；adopt 名归一化（不合规标 invalid 跳过）；落库 CustomSkill（frontmatter 原样/缺则拼装）；不删源

### FR-04: 前端两页区块
workspace skills 页（平台库启用+收编入口）；workspace mcp 页（资产库选入弹窗）；user 维度 library 页不变

## 非功能需求
- user 维度四点零回归（D-010 清单各测试）；manifest 向后兼容；.mcp.json 写路径复用审计
