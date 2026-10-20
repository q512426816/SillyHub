---
author: flow-machine-draft
created_at: 2026-10-20T05:34:08.285Z
---
# 设计记录（Design Record）— 2026-10-20-preset-engine-endpoint

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

前端两文件：①`config/llmProviderPresets.ts`——预设类型加可选 `codex: { base_url; default_model? }`，智谱 GLM 与 OpenCode Go 两条声明实测过的 codex 端点；②`components/llm-providers/llm-provider-form.tsx`——预设应用抽成按引擎分派（claude 形态=现有行为，codex 形态=覆盖端点+模型+清 env），引擎勾选 onChange 加联动：勾 Codex 且选中预设带覆盖 → 切 codex 形态并自动取消 Claude（平台一条凭证一个端点，两引擎同勾必有一坏）；取消 Codex → 回 claude 形态。选「勾选联动」而非「预设拆两条」（OpenCode Go Codex 预设另列）：预设选择器已拥挤、且用户先选供应商再选引擎是自然顺序，联动把「这家供应商对 codex 需要别的端点」这一平台约束显性化。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `LlmProviderPreset`（前端类型）：新增可选字段 `codex?: { base_url: string; default_model?: string }`。
- `applyPreset(preset)`（表单内部）：行为扩展——当前 agentKinds 仅含 codex（无 claude）且预设带覆盖时应用 codex 形态，否则 claude 形态（与现状一致）。
- 引擎勾选 onChange（表单内部）：选中带覆盖预设时的 codex↔claude 形态联动（详见 FR-02）；无预设/无覆盖时行为不变。
- 后端 / DB / daemon / API：无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   纯表单受控状态（React setState 顺序一致），无事件乱序面；假设成立。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   表单是单用户会话内组件状态，无并发面；保存提交走既有 API 串行。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   联动只改表单展示态，未保存前不落任何持久数据；切换预设/重置到自定义均走既有整表重置路径，无残留。编辑模式不渲染预设选择器（既有约束），联动不在编辑态出现。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   联动仅由当前选中预设与勾选态派生，无跨组件/跨会话状态；无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：自动取消 Claude 勾选对「我就想同一条都勾上」的用户是强制收敛——但该组合保存后 Claude 与 Codex 必有一侧拿到错端点（今日三次实证），表单放行等于制造坏配置；notice 明示原因与出路（另建一条），属正确性优先。次风险：applyPreset 按当前勾选分派，用户先点预设后改勾选时形态可能与其预期不符——勾选联动会把形态拉回与勾选一致的状态，自愈。

试过但放弃的方案：
- 预设拆成两条（OpenCode Go Codex 单列）：选择器条目翻倍且用户需自己判断选哪条，约束仍不可见；放弃。
- 保存时后端校验拦截坏组合（base_url 对勾选引擎不可达）：后端无法静态判定端点协议支持（需真实请求），动态探测成本高且时序不适配；放弃（表单联动前置收敛更便宜）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/config/llmProviderPresets.ts | 类型加可选 codex 覆盖；zhipu_glm/opencode_go 声明实测端点 |
| 修改 | frontend/src/components/llm-providers/llm-provider-form.tsx | applyPreset 按引擎分派 + 引擎勾选 codex↔claude 形态联动与 notice |
| 修改 | frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts | 新增覆盖常量断言 |
| 修改 | frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx | 新增联动 3 用例（勾 Codex 切换/取消恢复/自定义零联动） |
