---
author: flow-machine-draft
created_at: 2026-10-15T08:07:59.958Z
---
# 提案书（Proposal）— 2026-10-15-pseudo-domain-migration

## 动机

任务原话转写：用户指令：把平台仓存量伪域迁真域。背景：sillyspec 仓 2026-10-15-module-path-glob-match 修复了模块路径 glob 匹配（扫描卡 146 条 glob 形态 paths 在全部归属判定点恒不命中——FR 铸伪域/决策落 unmapped 的根因），修复止增量；本变更清偿存量：7 个 auto-* 伪域 92 条 FR 迁真域。迁移计划（来源变更交付文件三源判定 design 交付表/change-patch.json/git 提交面 → modulePathMatches 对真实模块图求域 → 排除 test-utils 取具体域优先）：auto-claude→frontend_components 17 条×5 变更+deploy 3 条；auto-deploy→deploy 2 条（人工改判：机械误判 sillyspec）；auto-frontend→frontend_components 47 条×10 变更；auto-github→ci 3 条；auto-releases→frontend_components 6 条；auto-sillyspec→frontend_components 4 条；auto-zcode→sillyspec 4 条+deploy_records 4 条（人工改判：发布记录跟随平台仓既有迁移先例 auto-backend→deploy_records）。

成功标准：
- 92 条全部迁出伪域（tests --redomain --write 逐批，ID 不变），digest 伪域信号归零
- 7 个 auto-*.md 删空壳，INDEX 路由无 auto-* 残留
- knowledge validate 全绿（锚点/注册/幽灵零新增）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 92 条全部迁出伪域（tests --redomain --write 逐批，ID 不变），digest 伪域信号归零
2. 7 个 auto-*.md 删空壳，INDEX 路由无 auto-* 残留
3. knowledge validate 全绿（锚点/注册/幽灵零新增）

## 成功标准（可验证）

1. 92 条全部迁出伪域（tests --redomain --write 逐批，ID 不变），digest 伪域信号归零
2. 7 个 auto-*.md 删空壳，INDEX 路由无 auto-* 残留
3. knowledge validate 全绿（锚点/注册/幽灵零新增）
