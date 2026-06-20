---
author: qinyi
created_at: 2026-06-21T01:05:40+0800
change: 2026-06-21-ppm-frontend-alignment
---

# ppm 前端交互对齐设计

## 1. 背景
当前 ppm 前端(2026-06-20-ppm-module-migration 迁入)是平铺 CRUD 表格;源 dept_project_front 是「主表+多级子表」+「角色化人员下拉(按项目/角色过滤)」。交互差距大(用户反馈成员/里程碑/模板/人员选择对不上),需对齐。

## 2. 设计目标
- W0-W4 全量对齐源 ppm 前端交互(P0-P3)
- 复用现有 lib/ppm API + ppm-status-actions + ppm-resource-table
- 纯前端为主(后端仅 project-member 加过滤)

## 3. 非目标
- 不改后端业务逻辑(仅 project-member query 加 pm_project_id+role_name 过滤)
- 不真上传(D-010,附件用 URL 管理 UI)
- 不弃现有平铺 CRUD(扩展,非重写)

## 4. 拆分判断
5 Wave,基础组件优先(方案 A),单变更内 Wave 管理。

## 5. 总体方案(W0-W4)
- **W0 基础组件**:`PpmUserSelect`(res+searchData)/`PpmText`(id→名)/`PpmDictSelect`(字典) + 后端 project-member 过滤
- **W1 项目成员**:角色 auth.Role 多选(D-009)+ 选用户联动回填部门/手机 + 项目→成员管理入口
- **W2 里程碑**:主子 expand(里程碑→明细)+ 模块三级(实施阶段:里程碑→模块→明细)+ 审批表单差异化(按 status 分草稿/审核/审批/变更/查看)+ AntD Timeline 履历
- **W3 计划节点模板**:明细行内批量编辑 + project_type 字典 + 责任人下拉
- **W4 细节**:附件 URL 管理(PpmFileUrls)+ 工作日联动 + 处置按钮

## 6. 文件变更清单
| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | frontend/src/components/ppm-user-select.tsx | 通用人员下拉(res+searchData,服务端搜索/分页) |
| 新增 | frontend/src/components/ppm-text.tsx | id→名字展示 |
| 新增 | frontend/src/components/ppm-dict-select.tsx | 字典下拉(项目类型/状态) |
| 新增 | frontend/src/components/ppm-file-urls.tsx | 附件多 URL 增删(D-010) |
| 新增 | frontend/src/components/ppm-sub-table.tsx | 主子展开/行内编辑 |
| 修改 | app/(dashboard)/ppm/project-members/page.tsx | 角色 auth.Role 多选 + 联动回填 + 入口 |
| 修改 | app/(dashboard)/ppm/milestone-details/page.tsx | 主子 expand + 模块三级 + 审批表单 + Timeline |
| 修改 | app/(dashboard)/ppm/plan-nodes/page.tsx | 行内批量编辑 + 字典 + 责任人下拉 |
| 修改 | app/(dashboard)/ppm/projects/page.tsx | 成员管理入口 |
| 修改 | frontend/src/lib/ppm/*.ts | project-member 过滤参数 |
| 修改 | backend/app/modules/ppm/project/{router,service}.py | project-member page 加 pm_project_id+role_name 过滤 |

## 7. 组件/接口定义
- **PpmUserSelect**:props `{ res: "user"|"projectMember"|"role"|"project"; searchData?: Record<string,string>; value; onChange }`。res 映射:user→/api/admin/users;projectMember→/api/ppm/project-member(page+searchData 过滤);role→/api/admin/roles;project→/api/ppm/project-maintenance/simple-list。服务端搜索+分页(对齐源 SillySelect resConfig)。
- **后端**:project-member page 加 query `pm_project_id` + `role_name`(WHERE 过滤),供审批人按角色筛。

## 8. 数据模型
无新表/无 schema 变更。后端 project-member query 加过滤参数。

## 9. 兼容策略
纯前端 + 1 个后端 query 增强(加可选过滤参数,不破坏现有)。现有平铺 CRUD 页面扩展(不弃)。

## 10. 风险登记
| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | W2 里程碑复杂(主子+模块+审批表单+timeline) | P1 | 分子 task;对照源 psplannode 组件逐个 |
| R-02 | W0 PpmUserSelect 通用性(res+searchData 覆盖多场景) | P1 | 参照源 SillySelect resConfig 6 资源 |
| R-03 | 角色改 auth.Role(D-009)与现有 ppm 数据兼容 | P2 | 角色值字符串,UI 改源;ETL 数据无影响 |
| R-04 | 行内批量编辑(W3)状态管理 | P2 | 受控表格 + 批量保存 |

## 11. 决策追踪
见 decisions.md。D-009@v1(角色 auth.Role,supersedes D-004@v1)+ D-010@v1(附件 URL,保持 D-007)被本设计覆盖。

## 12. 自审
- ✅ 需求覆盖:P0-P3 全覆盖(W0-W4)
- ✅ Grill 覆盖:D-009/D-010 引用
- ✅ 约定一致:App Router/apiFetch/lib/AntD+shadcn
- ✅ 真实性:源交互来自 Explore 调研
- ✅ YAGNI:非目标明确(不真上传/不改后端业务)
- ✅ 验收:各 Wave 独立 verify(对照源交互)
- ✅ 生命周期契约:不涉及(纯前端 + query 增强)
- ⚠️ 存疑:W2 审批表单差异化(源 6 表单)工作量大,实现时对照源 psplannode 逐个组件

## 13. Design Grill 交叉审查(2026-06-21)
status: **passed**(无 P0/P1 blocker)。
- **X-001**(P2)ETL 旧成员 `role_id`(源 system_role 值)与 D-009 UI auth.Role 选项(当前 auth.Role)不匹配 → 旧成员角色显示可能异常(新成员正常;数据迁移无影响,见 R-03)。W1 实现时兼容显示(未知 role_id 原样展示)
- Cross-check:D-009/D-010 与 §5/§7 一致;纯前端与 §8/§9 一致;PpmUserSelect 复用 lib/ppm+admin/roles 可行;W2 复杂度 R-01 已识别
