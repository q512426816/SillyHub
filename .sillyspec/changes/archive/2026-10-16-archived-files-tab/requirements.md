---
author: flow-machine-draft
created_at: 2026-10-16T00:40:54.454Z
---
# 需求规格（Requirements）— 2026-10-16-archived-files-tab

## 功能需求

### FR-01: visibleTabs 恒返回四 tab（archived 参数保留但不再收窄）

- Given 任意变更（在途或归档），When 调用 `visibleTabs(archived)`，Then MUST 恒返回
  `["overview", "assets", "process", "files"]` 四枚（顺序恒定）——归档态不再收窄
  （2026-10-16 用户裁决推翻 D-007@v1：归档留档不展示 spec 文档全貌，归档态同样需要
  文件树与范围对账入口）。

#### 场景：主路径

- 场景：归档与在途同集 — Given 归档与在途两种入参；When 分别调用；Then 返回值恒等且为四枚。



### FR-02: 归档态「文件与对账」面板可挂载，?tab=files 深链直达

- Given 归档态变更且地址栏带 `?tab=files`，When 页面渲染，Then MUST 挂载
  「文件与对账」面板（内嵌文件树 + 范围对账 + 关联快速任务）且 MUST NOT 触发
  `router.replace` 钳回概览。

#### 场景：主路径

- 场景：归档深链直达 — Given 归档态 + `?tab=files`；When 渲染完成；Then 文件面板在场、
  URL 保持不变。文件树区外层定高 560px（树/预览各自内滚，整列不无限高）。



### FR-03: 概览右信息栏对账入口归档态同在途一样指向「文件与对账」

- Given 概览右信息栏渲染范围对账组，When 变更为归档态，Then 对账入口文案 MUST 同在途
  一样为「明细见『文件与对账』」（MUST NOT 再指路「产出 · 归档留档」——该 tab 已恢复可见）。

#### 场景：主路径

- 场景：归档入口复原 — Given 归档态变更；When 渲染信息栏；Then 入口文案为
  「明细见『文件与对账』」。



### FR-04: 测试同步更新且质量门全绿

- Given 本口径变更改变了 tab 集与钳制行为，When 跑变更相关套件，Then
  `change-tabs` / `page-tabs` / `page-restore-assets` / `change-overview-side` /
  `change-files-panel` 测试 MUST 全部更新为断言新行为（MUST NOT 保留断言旧收窄行为
  的用例）且全绿；`tsc --noEmit` MUST 0 错。

#### 场景：主路径

- 场景：质量门 — Given 上述测试更新完成；When vitest + tsc 实测；Then 全部通过。



## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx
FR-02: src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx
FR-03: frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx
FR-04: frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx + frontend/src/components/changes/detail/__tests__/page-restore-assets.test.tsx

## 测试绑定

FR-01: frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx
FR-02: src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx
FR-03: frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx
FR-04: frontend/src/components/changes/detail/__tests__/page-restore-assets.test.tsx
