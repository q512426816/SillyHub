---
author: qinyi
created_at: 2026-10-13T16:05:00+08:00
---
# 需求规格（Requirements）— 2026-10-13-session-changefiles-archive-gate

## 功能需求

### FR-01: splitByArchive 与 stageLabel 的归档判定对齐平台双条件口径（status==='archived' 或 location==='archive' 任一命中即归已归档/显示已归档）

- 面板的归档判定**必须**采用双条件 `status === "archived" || location === "archive"`（对齐变更中心 isTerminalChange 终态定义），**禁止**只认 location 单信号；弹窗 Select 选项 label 的「已归档」后缀**必须**同口径。

#### 场景：主路径
Given 关联变更的 status='archived' 而 location 仍为 'active'（平台 status 侧信号先到、reparse 未收敛）
When 打开悬浮下拉
Then 该变更归入「已归档」组（默认折叠可展开），阶段标签显示「已归档」而非「干活中」

### FR-02: 新增用例：status=archived 且 location=active 的变更归入已归档组、不计数进行中徽标、阶段标签显示「已归档」

- 回归测试**必须**覆盖「status 侧先到」场景：面板用例（归组/徽标计数 0/展开后标签）+ splitByArchive 纯函数双条件断言。

#### 场景：主路径
Given 测试数据含 status=archived 且 location=active 的变更
When 渲染面板并展开归档组
Then 进行中计数为 0、归档组含该项、标签「已归档」、页面无「干活中」文本

### FR-03: 既有 8 用例保持全绿 + tsc 0 错

- 修复后既有用例**必须**全绿（不回退），`tsc --noEmit` **必须**零错误。

#### 场景：主路径
Given 修复与新增用例就位
When 跑组件测试文件 + tsc
Then 10/10 全绿、tsc 0 错

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「status=archived 而 location=active 的变更归入已归档组（用户实测：平台已归档但仍显示进行中）」
FR-02: test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「双条件口径：status=archived 而 location=active（status 侧先到）也归归档组」（splitByArchive 纯函数）+ 上述面板用例
FR-03: test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx（10 用例全绿）+ tsc --noEmit 0 错
