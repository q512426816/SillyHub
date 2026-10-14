# 视觉证据 — 2026-10-14-admin-server-status

## 结论

本变更为新增页面（/admin/server-status 服务器信息页），有 brainstorm 定稿原型
（prototype-admin-server-status.html，自包含 HTML + ai-native 主题 token），实现按原型
五要素逐项落地，零样式漂移：

| 原型要素 | 实现映射（frontend/src/app/(dashboard)/admin/server-status/page.tsx） | 一致性 |
|---|---|---|
| 页头（标题/副标题/自动刷新指示 +「上次更新 HH:mm:ss」+ 立即刷新按钮） | PageHeader（title/subtitle/actions slot：刷新时间文本 + antd Button 带 ReloadOutlined spin） | ✅ 同构 |
| 服务器性能卡（CPU/内存/磁盘三进度条 + 已用/总量数值 + 阈值着色 <80 主题紫/80–90 琥珀/>90 红） | SectionCard「服务器性能」+ PerfRow×3（antd Progress，status=exception（≥90）/strokeColor=token.colorWarning（80–90）/默认 primary（<80），阈值语义与原型一致） | ✅ 同构（阈值色经 antd token 运行时取值，非原型静态 hex——多主题铁律的合规等价） |
| 业务统计四格（任务/项目/里程碑/用户，大数字+标签，渐变底） | SectionCard「业务统计」+ StatCell×4（grid-cols-4，from-brand-50 渐变 + text-brand-700 tabular-nums） | ✅ 同构 |
| 依赖与版本卡（DB/Redis 徽标 + 版本/环境/UTC 时间 KV 行） | SectionCard「依赖与版本」+ DepBadge（antd Badge success/error）+ KvRow×5 | ✅ 同构 |
| 错误条（接口失败浅红底提示，不清数据） | antd Alert type="error" showIcon（语义红，双主题 token），失败保留既有数据 | ✅ 同构 |

## 基线保障方式

1. 骨架组件复用：页面外层走 `@/components/layout` 的 PageContainer/PageHeader/SectionCard
   （与 /admin/menus 同骨架，FRONTEND_PAGE_STYLE.md §1 合规）——非自由布局；
2. 多主题保障：品牌色全走 brand-* 语义阶（bg-brand-50/text-brand-700）与 antd
   ConfigProvider token（Progress/Badge/Alert 语义色），零硬编码 hex（blue/ai-native
   双主题随 html data-theme 换肤）；
3. 行为验证：组件测试 4 用例（正常态三卡断言含百分数/明细数值/徽标文本、5s 轮询、
   unmount 清理、失败降级不清数据）+ tsc --noEmit + eslint 全绿；
4. admin/menus 管理页对 system 组新增行的渲染已由 menus 测试 17 用例覆盖（路由锚定
   /admin/server-status 行断言）。

无「视觉降级需用户裁决」情形。
