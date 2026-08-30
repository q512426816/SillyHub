---
author: qinyi
created_at: 2026-07-31 22:27:06
---

# 需求规格（Requirements）

## 功能需求

### FR-01 per-user 技能归属
每个自定义技能归属创建者（`created_by` NOT NULL + ON DELETE CASCADE），用户注销级联删其技能。

### FR-02 per-user name 唯一
name 在「每个用户内」唯一（`(created_by, name)` 联合唯一），不同用户可建同名技能。

### FR-03 维护权限放宽
任何登录用户（无需 settings:admin / platform_admin）都能 CRUD 自己的自定义技能。

### FR-04 查询隔离
列表 / 详情只返回 `created_by == 当前用户` 的自定义技能；系统 sillyspec-* 全局只读共享不变。

### FR-05 越权防护
update / delete 别人的技能 → 404（不泄露存在）。

### FR-06 daemon 按用户同步
manifest / bundle 端点按当前用户过滤自定义技能；每个 daemon（归属某 user）拉到 = 系统 sillyspec-* + 该 user 自己的。

### FR-07 前端权限放开
技能管理菜单对所有登录用户可见；新增/编辑/删除按钮登录即可用（不再要 is_platform_admin）。

### FR-08 数据清空
现有全局 custom_skills 数据清空重置（迁移 DELETE）。

## 非功能需求
- daemon 侧零改动（API key 天然归属 user）。
- 迁移可重置（开发环境，downgrade 返回空表）。
- migration revision id 唯一、down_revision 接当前 head（多活跃变更防撞车）。
