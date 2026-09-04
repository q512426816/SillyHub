---
author: qinyi
created_at: 2026-08-30 22:23:33
---

# frontend_components 模块变更索引

- ql-20260903-012-7c69 | 删除 admin-organization-tree 组件及其测试——组织管理页全 antd 重构（见 frontend_app 侧同 ql 条目）后组织树由 DataTable treeData 行内承载，该组件零引用成死代码；admin-org-tree（users 页组织筛选树）不受影响
- ql-20260903-011-66a4 | 侧边栏菜单高亮最长匹配独占修复——isActive 原对每菜单独立前缀判断（absolute 走 startsWith(matchPattern)、相对走 includes），兄弟路径互相连累：/settings/providers 页「设置」(/settings) 与「我的供应商」同时选中，/settings/api-keys、/settings/skills、/settings/mcp 同理，「拓扑图」页「项目组组件」连亮；改 matchLength（命中规则不变、结果换算成匹配段长度）+ sidebarSections（渲染菜单集合提前算与 JSX 共用，空组不渲染标题行为保留）取最大值独占高亮；新增 __tests__/app-shell.test.tsx 8 用例（next/link mock 须透传 className，丢了断言不到 active 类）；Docker 前端镜像重建部署实测三页高亮正确

- ql-20260830-013-14b3 | session-usage-bar 摘要行小型化——六项指标名文本标签改 lucide 图标+原生 title 悬浮提示（ArrowDownToLine/ArrowUpFromLine/HardDriveDownload/HardDriveUpload/Repeat/Gauge），值 13px 粗体→11px medium 去抢眼，「按模型明细」按钮改 ChevronDown 图标按钮（title+aria-label 保语义），容器内边距 py-2.5→py-1.5；测试标签断言 getByText→getByTitle 同步（5 用例绿+tsc 0）
- ql-20260830-014-74f5 | session-usage-bar 悬浮提示升级 antd Tooltip——六项与明细切换按钮原生 title 改 antd Tooltip（先例 message-queue-bar，即时弹出+主题 token），触发元素补 aria-label（无障碍名+测试锚点）、移除 title 防浏览器双提示；测试断言 getByTitle→getByLabelText（5 用例绿+tsc 0）
- ql-20260831-010 | turn-timeline 轮次徽标输入侧 null 运行中显示「↑执行中…」——旧实现硬编码假「↑0」误导（GLM 流式期间 message_start 不携带输入、daemon 只从该事件取输入，轮内 inputTokens 常 null 而输出已实时累加）；对齐输出侧 isLive 分支（终态 null 仍「↑0」旧口径），补回归用例（22 用例绿+tsc 0）
