---
author: qinyi
created_at: 2026-10-30T12:26:40
---
# UI 视觉证据 — 2026-10-30-askuser-config-pending

> 探针 12 承接。证据形态：结构断言（类名/data 锚源码行）+ 原型对照论证（真码同方言机械一致性）。本变更不涉布局/主题机制，无需浏览器截图面；原型与实现同 tailwind 类名单源。

## 1. 原型→实现类名单源对照（D-007）

原型（frontend/src/components/prototype/session-config-pending-view.tsx）CtrlPill pending 态与实现逐类名一致：

| 面 | 原型 | 实现 |
|---|---|---|
| 供应商/档案胶囊 | `inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ... bg-brand-50 ring-1 ring-brand-400`（CtrlPill pending 分支） | session-config-bar.tsx ctrlButton pending 分支——`pending && "bg-brand-50 text-foreground ring-1 ring-brand-400"`（约 :995-1005 区段）同款 ring+浅底 |
| 思考档位胶囊 | 同上（原型四控件同 CtrlPill） | session-config-bar.tsx 档位触发器——`staged?.thinking_level !== undefined && "bg-brand-50 text-foreground ring-1 ring-brand-400"`（约 :1195-1215 区段） |
| 模型子下拉 | 同上（原型复刻 ctrlButton 形态） | session-config-bar.tsx 模型 select——`staged?.model !== undefined && "border-brand-400 bg-brand-50 ring-1 ring-brand-400"`（约 :1117-1135 区段；select 有原生 border，叠 border-brand-400 对齐视觉） |
| 悬停文案 | `title="已记住，将随下一条消息发送时生效"`（原型 CtrlPill pending title） | `STAGED_PENDING_TITLE = "已记住，将随下一条消息发送时生效"`（session-config-bar.tsx :91-97 常量），四处控件 title 分支同串（测试断言字面一致） |
| 文字角标 | 无（用户裁决去角标，原型 2026-10-30 二轮稿已删 Clock 节点） | 无（实现仅 data-staged-pending 不可见锚，无任何可见角标节点——测试断言形态为属性而非文本） |

brand 语义阶（ring-brand-400/bg-brand-50）经 themes.ts 双主题映射，随 data-theme 换肤——原型与实现同 token 源，非字面色。

## 2. 原型四态 ↔ 实现/测试场景映射

| 原型态（prototype-config-pending.html data-state） | 实现场景 | 测试锚 |
|---|---|---|
| active 现状·无暂存 | staged 字段全 undefined → 控件现状类名 | `存量调用面（未挂 onStagedSwitch）→ 四控件均无 data-staged-pending`（session-config-bar.test.tsx） |
| partial 改供应商+模型 | staged.llm_provider_id+model 存在 → 两控件亮 | `暂存供应商 → 供应商控件亮待生效态…级联模型重置暂存同亮`（session-config-bar.test.tsx） |
| all 四控件全改 | staged 四字段存在 → 全亮 | 档案/档位用例合并覆盖（`暂存档案 → 档案控件亮待生效态`、`暂存思考档位 → 档位控件亮待生效态`） |
| askuser 待答场景 | askuser 期间配置条保留可点可暂存（2026-10-26 既有能力零改动），暂存控件亮标 | 面板持久化用例（重挂载恢复高亮）+ FR-04 零改动 git status 实证 |

## 3. 结构断言（测试面）

- data-staged-pending="true" 仅出现在有暂存的控件按钮/select（session-config-bar.test.tsx 六用例：供应商/档案/档位各亮、cancel 消失、存量面无、ended 高亮仍在 title 转禁用文案）
- 高亮类名 bg-brand-50 在 className 断言（组件测试有 className 先例，样式态存在性证据；形态改版时该断言同步更新属预期）
- 原型产物与源码同源（prototype:build 编译，git diff 对账，禁手改）——frontend/prototype-dist/session-config-pending.html 已随 brainstorm 提交（efaf4d9d5）
