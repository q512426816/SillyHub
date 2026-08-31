---
author: qinyi
created_at: 2026-08-30 22:23:33
---

# frontend_components 模块变更索引

- ql-20260830-013-14b3 | session-usage-bar 摘要行小型化——六项指标名文本标签改 lucide 图标+原生 title 悬浮提示（ArrowDownToLine/ArrowUpFromLine/HardDriveDownload/HardDriveUpload/Repeat/Gauge），值 13px 粗体→11px medium 去抢眼，「按模型明细」按钮改 ChevronDown 图标按钮（title+aria-label 保语义），容器内边距 py-2.5→py-1.5；测试标签断言 getByText→getByTitle 同步（5 用例绿+tsc 0）
- ql-20260830-014-74f5 | session-usage-bar 悬浮提示升级 antd Tooltip——六项与明细切换按钮原生 title 改 antd Tooltip（先例 message-queue-bar，即时弹出+主题 token），触发元素补 aria-label（无障碍名+测试锚点）、移除 title 防浏览器双提示；测试断言 getByTitle→getByLabelText（5 用例绿+tsc 0）
- ql-20260831-010 | turn-timeline 轮次徽标输入侧 null 运行中显示「↑执行中…」——旧实现硬编码假「↑0」误导（GLM 流式期间 message_start 不携带输入、daemon 只从该事件取输入，轮内 inputTokens 常 null 而输出已实时累加）；对齐输出侧 isLive 分支（终态 null 仍「↑0」旧口径），补回归用例（22 用例绿+tsc 0）
