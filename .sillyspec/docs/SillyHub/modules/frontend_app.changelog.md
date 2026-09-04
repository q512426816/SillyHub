---
author: qinyi
created_at: 2026-09-03 14:49:48
---

# frontend_app 模块变更索引

- ql-20260903-014-4d37 | 组织管理页布局对齐 roles 页——查询条件与列表拆两块：SectionCard 只装工具栏+搜索表单，DataTable 移出作 PageContainer 独立兄弟块（gap-4 分隔，16px 间隔），错误条改替换表格位置（roles 同款）；用户实测反馈 ql-012 按 FRONTEND_PAGE_STYLE §1 字面把三者包一张卡与 admin 三页（roles/users）实际惯例不符
- ql-20260903-013-7a5e | 组织管理页表格横向滚动条修复——ql-012 按规范 §4 传 scroll={{x:'max-content'}} 是多列宽表惯例，本页 9 列窄表被强制按内容自然宽度（~1012px）撑开，容器不足即出横向滚动条；去掉 scroll.x 与配套 fixed:'right'+onCell（无横滚时固定列无意义）、操作列放开 width 按内容收缩，列宽自适应铺满容器（实测 scrollWidth=clientWidth 无滚动条）
- ql-20260903-012-7c69 | 组织管理页 /admin/organizations 全 antd 重构——按 FRONTEND_PAGE_STYLE 规范从手搓 div 抽屉/弹窗/Toast + shadcn Button 改为 PageContainer+PageHeader+SectionCard+DataTable 树表（antd Table treeData 承载组织层级，子组织默认展开、关键词/状态客户端过滤保留祖先链）；新建/编辑统一 antd Modal+Form vertical（父组织 TreeSelect 防环禁选自身后代、edit 模式 code 只读）；删除确认 antd Modal + toast 走 useNotify（AntApp message）；新增页测试 5 用例
