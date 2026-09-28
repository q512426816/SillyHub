---
author: flow-machine-draft
created_at: 2026-09-28T05:26:25.187Z
---
# 任务注册表（Tasks）— change-list-description

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: 提取规则共享纯函数 `title_norm.extract_description`（动机段→剥注释/「任务原话转写：」前缀→首个非空段→段内列表行剥除→「成功标准」截断→500 上限），形态回归 6 例（thin 机器稿/完整流程散文/无动机段/全空/纯列表回退/截断）
- [x] task-02: `changes.description` 可空列（model + 迁移 20260928140000，offline SQL 渲染验证 `ALTER TABLE changes ADD COLUMN description VARCHAR(500)`）
- [x] task-03: reparse 写路径接入（`_read_proposal` 单源共读，`ParsedChange.description` → `_build_change`/`_apply_parsed` 持久化；test_reparse_guard MagicMock fixture 补 description=None 显式属性）
- [x] task-04: documents 推送写路径接入（proposal.md 在场才重派生，部分推送不动既有描述——不互翻测试锚定）
- [x] task-05: ChangeSummary/ChangeRead 带 description（optional None，brownfield 安全）；列表搜索 ILIKE 扩列命中 description（service 层测试：按描述词命中且不计错行）
- [x] task-06: 变更中心列表行展示描述——桌面 IssueRow 标题块 basis-full 单行 truncate + 悬浮全文、移动 MobileChangeCard 描述行（无 hover 不加 title），无描述零占位（桌面 page.test 断言两态）；双端搜索 placeholder 提及描述
- [x] task-07: 相关测试全绿——backend test_title_normalization 28P + change/platform_sync 模块 886P（1 失败系 fixture 债已清偿复跑绿）+ reparse_guard 13P；frontend 桌面 132P + 移动 41P + tsc 0 错 + eslint 0 错（2 warning 为预存债非本变更文件行）
- [x] task-08: `pnpm gen:types` 再生成 api-types.ts（ChangeSummary/ChangeRead 含 description）+ openapi.json 随变更提交；provider-caps 再生成零内容差异不入提交面
