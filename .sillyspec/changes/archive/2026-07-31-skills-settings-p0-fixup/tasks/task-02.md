---
author: qinyi
created_at: 2026-07-31 11:45:37
id: task-02
title: 前端编辑弹窗 frontmatter 适配与校验
goal: |
  让编辑弹窗配合后端自动拼 frontmatter：正文只写 body、描述框给触发场景提示、新增头部预览、保存前校验加脏检测、保存成功 notify 生效提示。
implementation: |
  改 custom-skill-edit-dialog.tsx。一，content placeholder 换步骤骨架（何时使用/步骤/注意事项三段），加「插入步骤模板」按钮一键填入，并在正文区上方提示「头部 name 与 description 由系统用左侧名称和描述自动拼成，你只需写正文」。二，描述框下方灰字触发场景提示（例：用户要部署到服务器时按本技能打包镜像），描述少于 10 字给黄字软警告。三，新增「头部预览」固定区，实时渲染系统将拼出的 frontmatter（三根横线包裹 name 与 description 两行）。四，统一 validation useMemo：name 合法且非 sillyspec- 前缀、description 非空、content 非空；不通过时 disabled 保存按钮并提示原因。五，脏检测：与初始值比对，未改动禁用保存，提供「撤销改动」恢复初始。六，引入 useNotify，创建/编辑/删除成功 notify「已保存，需重启守护进程才生效，历史技能也会在下次同步后生效」；保存按钮上方灰字「保存后需守护进程重启才会生效」。
acceptance: |
  - 正文 placeholder 为步骤骨架，提供「插入步骤模板」按钮
  - 描述框下方有触发场景提示；描述小于 10 字有黄字警告
  - 有头部预览区，实时反映 name 与 description
  - 保存前校验 name/description/content，不通过禁用保存
  - 脏检测：未改动禁用保存，有撤销改动
  - 创建/编辑/删除成功弹 notify 生效提示
verify: |
  - cd frontend 与 pnpm test src/app/(dashboard)/settings/skills/__tests__/edit-dialog.test.tsx
  - cd frontend 与 pnpm exec tsc --noEmit
constraints: |
  - content 只写 body，不写 frontmatter（后端拼）
  - 复用 lib/errors 的 useNotify，文案用白话「守护进程」
  - 头部预览格式串与后端打包层拼装严格一致
allowed_paths:
  - frontend/src/components/custom-skill-edit-dialog.tsx
depends_on: []
---
