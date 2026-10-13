# UI 视觉证据 — 2026-10-13-session-change-files-hover

> 设计基准：`prototype-session-change-files-hover.html`（用户两轮确认：step4 选方案 A → step5 修正「不要圆圈、hover 直接下拉」后亲确认）。本文件为执行期对照留痕（verify 收口补记，探针 12 在场性要求）。

## 原型 → 实现对照

| 原型元素（prototype-*.html） | 实现落点 | 对照结论 |
|---|---|---|
| `.hover-entry` 胶囊入口（🗂 变更文件 + 计数徽标，非圆圈） | `frontend/src/components/daemon/session-change-files-hover.tsx` Button variant=outline rounded-lg + FolderGit2 图标 + count 徽标 | 一致（用户 step5 修正后形态） |
| `.cnt-pill.pulse` 徽标呼吸（在跑时） | 同文件 `animate-pulse` 条件类（running && active.length > 0），测试断言类名切换 | 一致 |
| `.chg-popover` hover 弹下拉分组列表（340px 宽） | antd Popover trigger=["hover","click"] + w-80 内容（进行中 N 置顶 + 已归档折叠） | 一致（触屏 click 兜底为原型 JS 同款交互） |
| `.chg-item`（change_key + 轻/全量徽标 + 阶段 pill + 时间） | renderItem（truncate + is_thin 徽标「轻量/全量」+ WORKFLOW_STAGE_LABELS 阶段中文 + zh-CN 时间） | 一致 |
| `.arch-toggle`（▸ 已归档（N）— 点击展开） | archive-toggle 按钮 + archiveExpanded 受控态，测试断言展开/收起 | 一致 |
| `.modal` 大弹窗（1152px × 85vh，头部下拉切换 + 文件树+预览） | shadcn Dialog h-[85vh] max-w-6xl（对齐 ChangeFilesCard 既有规格）+ antd Select 切换 + ChangeFileTree 内嵌（结构化预览/全屏预览组件自带） | 一致（85vh/max-w-6xl 与既有变更文件弹窗同规格） |
| 下拉/弹窗打开时 15s 自动刷新 | useSessionChanges refetchInterval 15s + ChangeFileTree autoRefreshMs=15000 | 一致（D-004@v1） |

## 降级与差异说明

- 颜色采用主题语义阶（emerald/amber/cyan + brand-*）替代原型硬编码 hex——FRONTEND_PAGE_STYLE §0 铁律，非视觉降级。
- 全屏预览走组件自带 FilePreviewModal（与变更文件页逐像素同源），原型仅为示意层。
- 无视觉降级裁决（未偏离设计基准），无需用户裁决留痕。
