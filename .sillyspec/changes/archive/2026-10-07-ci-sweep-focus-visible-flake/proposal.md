---
author: flow-machine-draft
created_at: 2026-10-07T15:53:04.895Z
---
# 提案书（Proposal）— 2026-10-07-ci-sweep-focus-visible-flake

## 动机

任务原话转写：CI 红清偿第 5 处：frontend-ci 偶发失败 delete-change-confirm.test.tsx——jsdom cssom 级联匹配缺陷族（坑档案 docs/sillyspec/finished/active-antd-jsdom-has-deploy-login-account.md 已甄别）：getComputedStyle 对注册规则做 DOM 匹配，遇 antd Checkbox  现代伪类把候选元素 tag+className 拼回选择器，候选元素带含逗号 tailwind 任意值类时生成非法选择器（CI 实测 span.text-,,,,px,, …）→ nwsapi SyntaxError 偶发炸用例（本地 ~1/20）。照 agent-profile-form.test.tsx 先例 stub window.getComputedStyle 阻断 cascade。

成功标准：
- delete-change-confirm.test.tsx 文件级 stub getComputedStyle（照先例形态+注释引用坑档案），19 用例全绿且连续多跑稳定
- eslint/tsc 0 错
- frontend-ci 推送后转绿（其余 workflow 不回归）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. delete-change-confirm.test.tsx 文件级 stub getComputedStyle（照先例形态+注释引用坑档案），19 用例全绿且连续多跑稳定
2. eslint/tsc 0 错
3. frontend-ci 推送后转绿（其余 workflow 不回归）

## 成功标准（可验证）

1. delete-change-confirm.test.tsx 文件级 stub getComputedStyle（照先例形态+注释引用坑档案），19 用例全绿且连续多跑稳定
2. eslint/tsc 0 错
3. frontend-ci 推送后转绿（其余 workflow 不回归）
