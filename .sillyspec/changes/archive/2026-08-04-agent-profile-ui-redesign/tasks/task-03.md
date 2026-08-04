---
author: qinyi
created_at: 2026-08-04 13:11:27
priority: P0
depends_on: [task-02]
requirement_ids: [FR-04, FR-05, FR-07]
decision_ids: [D-002@v1]
expects_from: task-02 提供 useMineAgentProfiles,需要 profiles 聚合列表
---

# task-03 卡片墙组件(card + grid + preview)

> 交付角色卡 + 卡片墙(搜索+三筛选+网格)+ 人设预览弹窗,全局页与 ws 内页复用,以卡片网格突破表格基准(D-002 特例仅限 agent-profile 目录)。

## allowed_paths

frontend/src/components/agent-profile/agent-profile-card.tsx
frontend/src/components/agent-profile/agent-profile-card-grid.tsx
frontend/src/components/agent-profile/agent-profile-preview.tsx

## implementation

- agent-profile-card(单卡)。card-top 头像(按 provider 渐变取首字母)+ 名称 + 供应商/模型 mono + 右贴可见 tag(复用 VISIBILITY_LABEL/VISIBILITY_TAG_COLOR);prompt 人设摘要 line-clamp-2 截断;abilities 能力 chip(mcp_refs + skill_refs 逐项);card-foot 版本号 + workspace_name + 操作(antd Button link 编辑/复制 + link danger 删除)。is_system_default=true 操作区改显「只读」灰字无按钮。底复用 SectionCard 基类 bg-card border rounded-lg shadow-sm hover lift。
- agent-profile-card-grid(卡片墙)。props 接 profiles + workspaceId 选填 + scopedToWorkspace 选填。搜索框 antd Input onPressEnter 回车触发(对齐 FRONTEND_PAGE_STYLE §3 文本不每键查);三筛选 antd Select(工作区/可见范围/供应商)onChange 即时触发,选项从 profiles 去重派生。网格 tailwind grid-cols-3 gap-4 对齐原型 repeat(3,1fr)。scopedToWorkspace=true 隐藏工作区筛选。空态 antd Empty。
- agent-profile-preview(预览弹窗)。props 接 profile + open + onClose。antd Modal title「人设预览」footer null 纯只读。正文两段,system_prompt 原文 pre 包裹可滚;模拟 prepend 到 CLAUDE.md 顶部片段展示拼接文本(不调 build_spec_bundle,真写入在 daemon 侧)。底部黄底 note「档案只存引用不存凭证」。

## acceptance

- 卡片墙渲染 profiles,搜索回车与三筛选 onChange 各自生效且可叠加。
- 系统预置卡显「只读」无编辑/复制/删除按钮。
- 点卡片弹预览展示 system_prompt 原文 + 模拟 CLAUDE.md 顶部片段,视觉对齐原型画面① 与 FRONTEND_PAGE_STYLE token 无硬编码 hex。

## verify

cd frontend && pnpm exec tsc --noEmit

## constraints

- 卡片墙封装在 agent-profile/ 目录不外溢(D-002 突破表格基准特例仅本页)。
- UI 中文;颜色走 tailwind CSS 变量与 antd Tag color 不硬编码 hex;组件用 antd(Input/Select/Modal/Button/Tag/Empty)+ tailwind 不引 shadcn。
