---
author: qinyi
created_at: 2026-06-20T14:46:30+0800
change: 2026-06-20-ppm-module-migration
---

# Proposal

## 动机
SillyHub 需要项目与问题管理(ppm)能力。源 `dept_project_back/ppdmq-module-ppm`(Java)+ `dept_project_front`(Vue3)已有成熟实现,全量复刻到 SillyHub(Python+Next.js),复用平台现有基础设施,不引入新语言/中间件。

## 关键问题
1. **跨语言/框架**:Java/Vue → Python/React,需重写而非平移,复刻 ~120 接口/22 表/2 套审批流
2. **silly 引擎依赖**:源里程碑明细走 silly 流程引擎(Master/Node/Variable 三表 + 动态表单),本项目无等价物 → 简化为状态机
3. **system 模块耦合**:源深度依赖用户/部门/站内信 → 复用本项目 auth/admin,通知最小化

## 变更范围
- 新建 `backend/app/modules/ppm/`(5 子域 + common),平台级,19 表,2 套状态机,PPM_* 权限,openpyxl 导出
- 新建 frontend ppm 页面 + `lib/ppm` API + 菜单权限
- W0–W6 分阶段推进

## 不在范围内(显式清单)
- 不做 silly 动态表单/变量表(D-002)
- 不做独立站内信(D-006)
- 不做文件上传服务(D-007)
- 不做历史数据迁移(D-008)
- 不做多租户

## 成功标准(可验证)
- 6 子域 CRUD + 导出 + 看板接口可用,平台级鉴权(require_permission_any)
- 问题清单 4 节点审批流状态机流转正确(申请→审核→处置→验证→关闭,bug 跳过部门经理)
- 里程碑明细状态机(草稿→审核→审批→完成 + 驳回 + 变更)正确
- 前端各子域页面可访问,菜单权限生效
- 现有 auth/admin/workspace 业务不受影响
