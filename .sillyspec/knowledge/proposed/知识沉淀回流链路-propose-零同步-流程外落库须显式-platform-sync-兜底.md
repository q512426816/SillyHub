---
proposed_at: 2026-11-03T02:05:19.069Z
category: conventions
source: session-distill:2026-11-03
status: pending_review
---

# 知识沉淀回流链路——propose 零同步，流程外落库须显式 platform sync 兜底

## 问题
knowledge propose 只落盘不上行；上行触发点全部挂在 run/flow 流程事件内（步进、收口、approve），纯沉淀会话跑完 propose 即收工，没有后续流程命令。会话收尾自动上行属 best-effort 且失败静默（仅 warn 下次自动重试）——propose 若是会话最后一条命令就没有下次，条目静默滞留本地树，无任何告警面。

## 解法
propose 完成后显式跑 sillyspec platform sync（不带 --change，全树 diff 收敛）确认回流；未连接平台时 sync 静默跳过，须在汇报中留痕。另外：沉淀提示词给定的 daemon 规范树路径须先核验注册状态——daemon specs/ 下的树要么是托管工作区、要么是指向各项目 .sillyspec 的 junction；路径不存在且 sessions.json、manifests、workspaces、config 全零命中的 UUID 是悬空引用，propose 进去只会造出无人同步的孤儿树。本机（2026-11-03）实例：multi-agent-platform 的平台同步面就是仓内 .sillyspec（daemon specs/29f4a6d1 junction 直指它），默认落盘即同步面，本批 5 条即按「默认落本仓 .sillyspec + 显式 platform sync」执行。

## 证据
- src/run/shared.js triggerSync 契约注释（best-effort 事件驱动，重试靠下一条命令兜底，:1057/:1169 附近）——本机 sillyspec 仓 v3.34.0 grep 核验
- knowledge propose 仅命令行落盘无上行（本会话评审结论；本机实测无参调用仅校验 --title 必填）
- 本机注册面核验：4e9eb05b 在 sessions.json/manifests/workspaces/zcode/config 全零命中；sillyspec platform status 显示本地与平台进度同步（crrcdt.ppdmq.top）

## 适用条件
平台模式（platform connect 已配置）；离线纯本地仓不适用，但条目滞留风险同样存在。

---
> This is a proposed knowledge entry. Review and merge into manual/ or generated/.