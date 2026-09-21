## FR-skill-manager-001 workspace 维度技能启用与并集注入
变更：2026-09-11-workspace-asset-bridges
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given git 技能在库且 workspace 成员启用（workspace_id 行）；When 该 workspace 的会话/任务拉 bundle；Then manifest(?workspace_id) 返回 user∪workspace 并集；daemon per-workspace 槽分发，workdir 含并
全文：.sillyspec/changes/archive/2026-09-11-workspace-asset-bridges/requirements.md#FR-01
最近确认：00430aba8

## FR-skill-manager-002 MCP 资产库选入 workspace
变更：2026-09-11-workspace-asset-bridges
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台库 server（可见性校验：跨用户私有 404）；When 成员 POST import-from-registry；Then .mcp.json 合入该 server（解密 env 明文写入，同名改名 -registry）；解密失败 422；registry 状态零变化
全文：.sillyspec/changes/archive/2026-09-11-workspace-asset-bridges/requirements.md#FR-02
最近确认：00430aba8

## FR-skill-manager-003 specDir 收编
变更：2026-09-11-workspace-asset-bridges
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given workspace skills 页触发 adoptable；Then 差集列表（排 CustomSkill 全体∪sillyspec-*∪git discover 全 enabled 源）；adopt 名归一化（不合规标 inva
全文：.sillyspec/changes/archive/2026-09-11-workspace-asset-bridges/requirements.md#FR-03
最近确认：00430aba8

## FR-skill-manager-004 前端两页区块
变更：2026-09-11-workspace-asset-bridges
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-11-workspace-asset-bridges/requirements.md#FR-04
最近确认：00430aba8
