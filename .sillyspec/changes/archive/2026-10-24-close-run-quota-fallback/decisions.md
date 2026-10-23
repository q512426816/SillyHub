---
author: flow-machine-draft
created_at: 2026-10-23T16:37:11.523Z
---
# 决策记录（Decisions）— 2026-10-24-close-run-quota-fallback

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是**误报**——把非限额失败标成 quota_exceeded。缓解：双重锚定（必须同时含 429 状态码与限额关键词，正则逐条对齐 classifier.ts 规则 1），且 429 语义即 Too Many Requests、配限额关键词才定 quota（纯 429 落 rate_limited 的情形本方案不推断、保持现状）；实测 9-04/10-23 两批真实限额文本均稳定命中。次风险：推断规则的维护漂移（daemon 侧改文案后端不知道）——注释钉死对齐源路径，daemon classifier 改动时须同步（评审检查点）。 试过但放弃的方案：① 前端兜底（失败卡渲染时翻时间线日志找 API Error 行）——前端拿不到结构化 run 日志查询入口，且 error_detail 为空时 buildSystemFailureItem 只吃 error_code/failure_summary 两参，跨组件翻日志链路重、auto_resume（后端读 error_detail）完全受益不到，放弃。② 后端复制 daemon 全类型分类规则——双源维护面大，auth/timeout 等类型文本特征弱误报高，收窄为 quota 专项（理由见做法概述）。③ 只升级 daemon 不改后端——那台机器不归本平台代码库管，升级排期不可控，且未来任何机器的 daemon 版本倒挂都会复发，后端兜底是对部署倒置的结构性防御。
