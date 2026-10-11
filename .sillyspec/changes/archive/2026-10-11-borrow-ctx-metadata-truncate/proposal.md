---
author: flow-machine-draft
created_at: 2026-10-11T04:31:07.280Z
---
# 提案书（Proposal）— 2026-10-11-borrow-ctx-metadata-truncate

## 动机

任务原话转写：沙箱 AGENTS.md 渲染中 tech_stack/repo_url 不截断，绕过 description 的 500 字符注入防线（24h 审查 P3-3）：32bc06602 的 borrow-sandbox-context.ts 仅 description 有 DESCRIPTION_MAX_CHARS=500 截断（design R-02 点名的注入缓解），tech_stack 数组 join 与 repo_url 原样进自动加载的 AGENTS.md 正文，而 backend workspace schema 两字段均无长度上限——有工作区编辑权限的成员可借超长/指令样式字段注入借用沙箱 agent。修复：tech_stack join 后与 repo_url 复用同款 500 字符截断（含「…（已截断）」标注），防线对齐 description。
成功标准：
- tech_stack join 结果超 500 字符时截断加「…（已截断）」标注，与 description 同款
- repo_url 超 500 字符同款截断
- 短字段（≤500）逐字原样（零回归）
- 截断对 name/slug/display_alias/default_branch 等既有字段零影响
- 渲染幂等不变（同 ctx 重复渲染输出一致）
- 新增截断用例先红后绿，既有渲染/透传/三态用例全绿 + tsc 零错

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. tech_stack join 结果超 500 字符时截断加「…（已截断）」标注，与 description 同款
2. repo_url 超 500 字符同款截断
3. 短字段（≤500）逐字原样（零回归）
4. 截断对 name/slug/display_alias/default_branch 等既有字段零影响
5. 渲染幂等不变（同 ctx 重复渲染输出一致）
6. 新增截断用例先红后绿，既有渲染/透传/三态用例全绿 + tsc 零错

## 成功标准（可验证）

1. tech_stack join 结果超 500 字符时截断加「…（已截断）」标注，与 description 同款
2. repo_url 超 500 字符同款截断
3. 短字段（≤500）逐字原样（零回归）
4. 截断对 name/slug/display_alias/default_branch 等既有字段零影响
5. 渲染幂等不变（同 ctx 重复渲染输出一致）
6. 新增截断用例先红后绿，既有渲染/透传/三态用例全绿 + tsc 零错
