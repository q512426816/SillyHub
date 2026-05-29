---
author: qinyi
created_at: 2026-05-27 09:44:37
---

# CONCERNS

## 严重

- 工作区创建当前拒绝非 `.sillyspec` 项目：`WorkspaceService.create_from_scan` 在扫描结果 `is_sillyspec=False` 时抛出 `WorkspaceNotSillyspec`，对应测试也固化了这个行为。这会阻止平台管理普通代码仓库。
- 平台多个核心模块读取目标项目下的 `.sillyspec` 结构：components、scan docs、changes、tasks、runtime 都默认从 workspace root 解析 `.sillyspec`。

## 中等

- 平台设置页存在 `sillyspec_path` 字段，但从扫描结果看，它尚未成为 workspace 创建/扫描的统一能力入口。
- 前端扫描弹窗把 `.sillyspec` 状态作为成功/失败视觉信号，会强化“非 sillyspec 项目不可管理”的产品语义。
- `frontend/pnpm-lock.yaml` 中出现若干 deprecated 依赖提示，其中包括 Next.js 安全升级提示，需要单独评估。

## 低

- 当前仓库扫描文档之前缺失，已补齐本轮扫描文档。
- 部分历史 docs 中的迁移编号与当前迁移文件名可能存在计划/实现漂移。
