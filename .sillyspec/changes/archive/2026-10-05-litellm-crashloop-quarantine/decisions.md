---
author: flow-machine-draft
created_at: 2026-10-05T00:27:24.531Z
---
# 决策记录（Decisions）— 2026-10-05-litellm-crashloop-quarantine

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险=恢复路径被遗忘：2026-10-05 本地矩阵已证伪「选新 tag」路线（无可 pin 的 「健康镜像 + gap-A」组合），分叉（①等上游修复版 / ②自研薄适配层退役 litellm）拍板后 的专门变更若漏处理两处 profiles 行——分叉①下 litellm 不随默认栈拉起，表象是 OpenAI 型 供应商经 litellm 的链路静默缺失（该链路当前尚未启用，短期无感，正因此更易被遗忘）。 缓解：compose 两处注释与坑文档 2026-10-05 隔离加固段三处互指「恢复/退役=专门变更处理 profiles 行」，且坑文档保持 docs/sillyspec/ 活跃区跟踪至分叉拍板与移除闭环。 试过但放弃的方案：① 注释掉整个服务块——配置失去可见性、恢复 diff 噪音大；② `restart: no` ——`up -d` 仍会拉起坏镜像执行一次 127 崩溃（低配机白拉镜像层），且违背 NFR-03 的 always 语义、恢复时易忘改回；③ 依赖「服务器已手动 stop + 注释提醒」——已被 2026-10-04 实践证伪： stop 状态挡不住下一次 `up -d`（这正是本变更的动因）。
