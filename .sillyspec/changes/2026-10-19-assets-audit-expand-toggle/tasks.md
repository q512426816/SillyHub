---
author: flow-machine-draft
created_at: 2026-10-19T01:06:36.704Z
---
# 任务注册表（Tasks）— 2026-10-19-assets-audit-expand-toggle

- [x] task-01: 组件修复——归档留档改动文件清单 `</ul>` 后补 GroupToggle（total=清单总条数，unit=个文件，key=audit），跑「超 5 条可展开/收起」用例验证绿
- [x] task-02: 补测试——超 5 条（7 文件）展开后第 6/7 条可见再收起回 5 条；≤5 条（FULL fixture 2 条）断言无展开按钮，验证绿
- [ ] task-03: 回归验证——change-assets-card 聚焦测试全绿 + `pnpm -C frontend exec tsc --noEmit` 零错误，既有用例（diff 弹窗/清单已截断标注）不回退
