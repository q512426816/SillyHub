---
author: qinyi
created_at: 2026-08-20T10:00:00
---

# 提案书（Proposal）

## 动机

用户经 ui-ux-pro-max 技能生成并评审确认 AI-Native 视觉模板（`prototype-frontend-ai-native-style.html`），要求将全站样式从现版"明亮蓝"切换为"AI 紫"新方向，并在澄清中明确要求**本变更直接实现蓝↔AI紫可切换主题**（新主题默认，可一键切回旧观感）。

## 关键问题

1. **品牌蓝硬编码渗透全站**：198 处 `bg/text/border-blue-*` 类（56 文件）+ 17 处 hex + kanban PALETTE + 登录页渐变 + globals.css spinner 蓝，这些不走 token，换主题时不会跟随，是主题化的最大障碍。
2. **现有 token 层是单主题静态常量**：`tokens.ts` 只有一套 blue palette，antd ConfigProvider 编译期绑定，无任何主题切换机制。
3. **会话页缺 AI 产品质感**：SSE 流式输出无光标反馈、无等待指示、无上下文引用展示，与"智能体平台"定位不匹配。

## 变更范围

- 主题注册表 `themes.ts`（blue/ai-native 两套）+ brand 语义色阶（CSS 变量双套）+ zustand 主题 store（localStorage 持久化）+ 顶栏切换入口 + SSR 防闪烁
- antd ConfigProvider 动态化（token 跟随当前主题）
- 蓝色清扫：品牌用途（含浅档）→ brand 阶；hex → 主题引用；9 文件 message 裸调迁 useNotify
- 会话页 AI 原生细节（流式光标/typing 三点/上下文 chip，仅表现层）
- tokens.ts 删除及 9 处消费方迁移

## 不在范围内（显式清单）

- 不做暗色模式（`.dark` 变量位继续预留）
- 不做第三套主题/主题自定义器
- 不改业务逻辑/数据流/API/SSE 协议（零后端变更）
- 不替换 antd 组件、不引新 UI 库
- 不做移动端 m/* 专项适配（顺带受益不逐页核对）
- 不做 antd cssVar 模式优化（实测闪烁明显才另立项）

## 成功标准（可验证）

- 两套主题一键切换全站即时生效（antd + Tailwind 语义类 + brand 阶全部跟随），刷新后偏好保持，首帧无主题闪烁
- grep 复核品牌用途蓝清零：`bg-blue|text-blue|border-blue|#2563eb|#3b82f6|rgba(22, 119, 255` 仅剩信息语义场景（逐一判断）
- blue 主题按 §9 验收口径逐页对照重构前截图一致（info 徽标档除外，D-003@v2 例外声明）
- `pnpm -C frontend exec tsc --noEmit` + eslint 0 error；vitest 新增单测全绿
- Docker rebuild 后两主题核心页（工作区/会话/PPM 表格/登录/kanban）截图对照原型通过
