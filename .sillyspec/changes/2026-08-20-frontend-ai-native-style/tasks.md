---
author: qinyi
created_at: 2026-08-20T10:00:00
---

# 任务清单（Tasks）

> 骨架清单，plan 阶段展开为 Wave + 依赖 + 验收步骤。

- [ ] task-01: `styles/themes.ts` 主题注册表（blue/ai-native 两套 + BrandScale + DEFAULT_THEME）
- [ ] task-02: `globals.css` 双套 CSS 变量（含 brand 阶 50-950 双套）+ `::selection`/`:focus-visible`/滚动条/spinner 硬编码蓝改 var
- [ ] task-03: `tailwind.config.ts` 增 `brand` 语义阶（走 `var(--color-brand-*)`）
- [ ] task-04: `stores/theme.ts` 主题 store（zustand persist，key `sillyhub-theme`）
- [ ] task-05: `antd-providers.tsx` 动态化（token 取当前主题 + useEffect 同步 html data-theme）
- [ ] task-06: `app/layout.tsx` 防闪烁 inline script（读 localStorage 设 data-theme，兜底 ai-native）
- [ ] task-07: `theme-toggle.tsx` 组件 + `top-bar.tsx` 接入
- [ ] task-08: 删除 `tokens.ts`，9 处消费方迁移 themes.ts（antd-providers / work-hour-statistics / topology / kanban×4 / aggregations.ts / styles/index.ts barrel）
- [ ] task-09: 蓝色清扫 Wave A——ppm/kanban 集群（品牌用途含浅档→brand-*；PALETTE 阶引用迁移）
- [ ] task-10: 蓝色清扫 Wave B——workspaces/sessions/admin/settings/app 页面
- [ ] task-11: 蓝色清扫 Wave C——components/lib 杂项 + 9 文件 message 裸调迁 useNotify
- [ ] task-12: `status-badge.tsx` info 档改 accent 青 + 登录页主题化
- [ ] task-13: 会话页 AI 细节（流式光标/typing 三点/ctx-chip，whoLine 数据源，reduced-motion 退化）
- [ ] task-14: 单测（themes 两套结构一致性 / store 切换与持久化 / antd token 跟随）
- [ ] task-15: 验收（grep 复核清零 / tsc+eslint / Docker rebuild 两主题截图对照 + blue 逐页对照 / FRONTEND_PAGE_STYLE.md 与 scan 文档同步）
