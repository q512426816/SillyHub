---
author: flow-machine-draft
created_at: 2026-10-27T04:32:48.841Z
---
# 需求规格（Requirements）— 2026-10-27-sessions-panes-gap-remove

## 功能需求

### FR-01: sessions-portal-panes 容器 className 删除 gap-3（其余类 flex min-h-0 flex-1 overflow-hidden 保持）

- 会话门户双栏容器（data-testid="sessions-portal-panes"）必须从 className 中移除 gap-3；其余类（flex min-h-0 flex-1 overflow-hidden）必须保持不变。

#### 场景：主路径

- Given：会话门户页（/sessions）渲染
- When：检查 panes 容器 className
- Then：为 `flex min-h-0 flex-1 overflow-hidden`（无 gap-3），列表栏与聊天栏之间仅剩拖拽把手 6px 条

### FR-02: 左把手/右把手（PanelResizer）渲染与拖拽功能零回归（自身 w-1.5 在场）

- 左右拖拽把手（PanelResizer）必须保持渲染与拖拽功能不变（自身 w-1.5 宽度独立于容器 gap），禁止因删 gap 产生把手消失或拖拽失灵。

#### 场景：主路径

- Given：panes 容器不再有 gap-3
- When：渲染左把手（sessions-left-resizer）及文件预览右把手
- Then：把手 6px 可拖条在场、aria-label 语义与宽度拖拽边界（240-560 等）不变

### FR-03: sessions-portal 相关测试与 lint 通过

- 触及文件相关测试与 lint 必须全绿，禁止既有用例回归。

#### 场景：主路径

- Given：代码改动完成
- When：跑 sessions-portal 测试 + lint
- Then：全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「panes 容器类名断言（gap-3 移除后 flex min-h-0 flex-1 overflow-hidden）」——现有用例只查 testid 在场，本变更补类名断言
FR-02: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx 既有渲染回归套件（把手挂载断言沿用）+ PanelResizer 自身 w-1.5 类（components/ui/panel-resizer.tsx:144 源码锚，无需新测）
FR-03: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx 全文件 + pnpm exec eslint 触及文件 0 errors
