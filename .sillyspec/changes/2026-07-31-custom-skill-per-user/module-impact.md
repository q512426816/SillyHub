---
author: qinyi
created_at: 2026-08-30 20:10:00
change: 2026-07-31-custom-skill-per-user
---

# 模块影响分析（Module Impact）— 自定义技能 per-user 独立 + 维护权限放宽

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:skills | 逻辑变更+数据结构变更 | CustomSkill per-user 归属（created_by 隔离/跨用户同名 404）；manifest/bundle 按 user 同步（skills_bundle_service per-user 过滤） |
| frontend:components-admin / app 页 | 逻辑变更 | 技能维护页 per-user 视角 + 菜单权限放宽（空 perms=登录可见，permission.ts 口径）+ edit-dialog/page 测试 |
| sillyhub-daemon | 调用关系变更 | daemon 带 API key/JWT 天然归属 user（manifest 请求 per-user 语义，集成实测验证） |

## 未匹配文件

无（21 files 914+/225- 全部落上述模块）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `backend modules/skills.md` | per-user 隔离语义已收录（grep 核实 6 命中） | skipped（已同步） |
| `frontend modules/components-admin.md`/`lib-mcp-skills.md` 等 | custom-skills/权限放宽语义已收录（grep 核实） | skipped（已同步） |
| `_module-map.yaml` | 无模块增删；CustomSkill/CustomSkillService 已列 | skipped（已同步） |
