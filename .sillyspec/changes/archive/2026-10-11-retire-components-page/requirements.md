---
author: flow-machine-draft
created_at: 2026-10-11T03:59:27.322Z
---
# 需求规格（Requirements）— 2026-10-11-retire-components-page

## 功能需求

### FR-01: 工作区详情不再出现「项目组件」入口与页面（桌面 + 移动端子页均移除）

- 前端**必须**移除「项目组组件/拓扑图」侧边栏菜单项、工作区 tabs 的组件入口、/components 与 /components/topology 两个页面路由及统计卡「项目组组件」格；桌面与移动端**禁止**残留任何指向已删页面的入口。

#### 场景：主路径

- Given 已部署本变更的前端
- When 打开任意工作区详情（桌面或移动端）
- Then 侧边栏/tabs/统计卡均无「项目组组件」「拓扑图」入口，直接访问 /workspaces/{id}/components 返回 404- （待撰写：把本条成功标准改写为一句可判定的行为规定并标约束强度——必须/禁止/SHOULD/可以）

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）- 本变更 diff **必须**仅触 frontend/src；backend 代码、openapi.json、api-types.ts **禁止**有任何变化（components/generate-projects 端点保留不删）。

#### 场景：主路径

- Given 本变更提交
- When 审查 diff 文件清单
- Then 全部路径以前端 src/ 前缀，生成物零 diff- （待撰写：把本条成功标准改写为一句可判定的行为规定并标约束强度——必须/禁止/SHOULD/可以）

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）- 前端**必须**清理对已删页面的全部引用（导航/链接/lib 封装/hook 分支/测试用例），`tsc --noEmit` 与 `pnpm lint` **必须**零错误（悬空引用即编译失败）。

#### 场景：主路径

- Given 引用清理完成后
- When 跑 pnpm typecheck 与 pnpm lint
- Then 两者零错误零警告新增- （待撰写：把本条成功标准改写为一句可判定的行为规定并标约束强度——必须/禁止/SHOULD/可以）

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）- 验证**必须**仅跑本变更触达的测试文件（六文件 117 用例）+ typecheck + lint；**禁止**跑全量测试套件（留给 CI）。

#### 场景：主路径

- Given 代码清理完成
- When 跑受影响六测试文件
- Then 117/117 全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: src/lib/__tests__/menu-permissions.test.ts「MENU_PERMISSION_GROUPS 长度 === 36」+ src/app/(dashboard)/workspaces/[id]/page.test.tsx「统计三数字按 mock 数据渲染」（queryByText 项目组组件 not.toBeInTheDocument）
FR-02: 不适用：后端零改动（成功标准即约束本身——本变更 diff 仅 frontend/src）
FR-03: src/components/__tests__/app-shell.test.tsx「/workspaces：仅工作区首页高亮」等既有高亮回归 + tsc --noEmit 零死引用（typecheck 过=无悬空 import/类型）
FR-04: 本次实跑触达五测试文件（menu-permissions/page/app-shell/workspace-config-card/use-page-session-context）+ menu-overrides 回归共 117 用例全绿；pnpm exec tsc --noEmit 与 pnpm lint 双零错（实跑于 2026-10-11 会话）
