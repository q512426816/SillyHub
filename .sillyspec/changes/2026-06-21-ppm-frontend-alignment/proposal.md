---
author: qinyi
created_at: 2026-06-21T01:05:40+0800
change: 2026-06-21-ppm-frontend-alignment
---

# Proposal

## 动机
当前 ppm 前端(平铺 CRUD)与源 dept_project_front(主表+多级子表+角色化人员下拉)交互差距大,用户反馈成员/里程碑/模板/人员选择对不上。

## 关键问题
1. 人员选择全是文本框(源是按项目/角色过滤下拉)→ 人填不出
2. 主子表/多级子表(里程碑/模板)缺失 → 层级交互丢失
3. 审批表单未差异化 + 角色硬编码

## 变更范围
W0-W4 全量对齐源前端交互(基础组件→成员→里程碑→模板→细节),纯前端 + 1 query 增强。

## 不在范围内
- 不改后端业务(仅 project-member query 加过滤)
- 不真上传(D-010,附件 URL 管理)
- 不弃现有平铺 CRUD(扩展)

## 成功标准
- 人员下拉(PpmUserSelect res+searchData)覆盖所有 *_user_id 字段,按项目/角色过滤
- 里程碑主子展开 + 模块三级 + 审批表单差异化 + Timeline
- 项目成员角色 auth.Role 多选 + 选用户联动回填
- 计划节点模板行内批量编辑 + 字典
- 对照源交互逐项 verify
