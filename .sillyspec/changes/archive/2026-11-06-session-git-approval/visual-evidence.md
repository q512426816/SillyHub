# UI 视觉证据（2026-11-06-session-git-approval）

## 证据形态：真码原型产物（管线编译，非手绘）

- **原型产物**：`.sillyspec/changes/2026-11-06-session-git-approval/prototype-git-approval.html`（181KB 自包含离线 HTML，双击可开、右上三主题切换、三态按钮切换：提交确认/推送确认/拒绝原因）
- **原型源**：`frontend/src/components/prototype/git-approval-view.tsx`（真码管线 `pnpm prototype:build` 编译，源+产物同提交批准冻结；原型重编译对账见 task-15——源零 diff、产物同步本留档）
- **素材来源声明**：源文件头注释（对话卡外壳/文件树行/token/图标/交互五要素逐项锚定真实组件与依赖）

## 实现对照（QA 验收审查 execute-review-2026-11-07-100026 形态核对节选）

- 生产组件 `frontend/src/components/daemon/git-approval-card.tsx` 与原型同方言：三分组目录树（buildFileTree 复用）/四色状态徽标/`+N -M` 增删统计（tabular-nums）/目录级勾选（已选/总数）/push 按条提交可展开文件明细/保护分支警示徽标（border-error/40 bg-error/10）/拒绝快捷原因 chips——全部走语义 token（brand-*/border/bg-card/text-*），零硬编码 hex。
- 组件测试 `git-approval-card.test.tsx` 12 用例对上述形态逐项断言（三分组渲染/勾选联动/警示徽标/展开明细）。

## 降级裁决

无降级——真码管线在场（local.yaml `ui_prototype: form: real-code` 已登记），产物三主题可切、离线可跑。
