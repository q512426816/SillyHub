---
proposed_at: 2026-11-03T03:07:40.358Z
category: conventions
source: session-distill:2026-11-03
status: pending_review
---

# 知识沉淀回流链路——propose 零同步，流程外落库须显式 platform sync 兜底

## 问题
knowledge propose 只落盘不上行；上行触发点全部挂在 run/flow 流程事件内（步进、收口、approve），纯沉淀会话跑完 propose 即收工，没有后续流程命令，会话收尾自动上行又属 best-effort 且失败静默——条目可能无声滞留本地树，无告警面。另外两个回流拦路虎：其一，沉淀提示词给定的 daemon 规范树路径可能是悬空引用——daemon specs/ 下的树要么是托管工作区、要么是指向各项目 .sillyspec 的 junction，路径不存在且 sessions.json、manifests、workspaces、config 全零命中的 UUID，propose 进去只会静默 mkdir 出无人同步的孤儿树；其二，platform sync 不认 --spec-dir（对不存在的根静默忽略照常报成功），根解析走 cwd/.sillyspec-platform.json 平台指针——指针误指他仓 junction 时，sync 的 0 差异回执与本仓提案完全无关，拿它当回流确认是假阴性。

## 解法
propose 进平台同步面（本机实例：仓内 .sillyspec，daemon specs/29f4a6d1 junction 直指它），随后显式跑 sillyspec platform sync（不带 --change）并按两步解读回执：第一步 sillyspec platform pointer 核对 specRoot 确实指向本仓同步面（指针误指先修指针，正规途径是重跑平台 scan 重建，或对 flow 类命令显式 --spec-dir——注意该覆盖对 platform sync 无效）；第二步根正确时，walkSpecTree 全树递归（排除面仅 .runtime、runtime、projects、worktrees、local.yaml，knowledge/proposed 在内）且 computeSpecOps 对本地有而服务器无的路径必发 add、dropFollowServerUpdates 只丢 update 从不丢 add——故 0 文件差异且本地确有新增提案即服务器已含同内容，回流成立的正向确认。2026-11-03 实证教训：本机指针曾误指 b97f8231（另一仓 junction），两次 sync 的 0 差异由此不能证明本仓 5 条提案已回流——回执解读前先核对指针，勿跳步。

## 证据
- src/spec-sync.js walkSpecTree（全树递归与排除面）、computeSpecOps（add 生成规则）、dropFollowServerUpdates（只丢 update）——sillyspec 仓 v3.34.0
- src/sync.js safePlatformSpecDir(this.cwd) 与 agent-session-log.js:1281（平台指针优先级注释）；src/flow.js:3128（显式 --spec-dir > 指针，flow 类命令生效）
- 本机实证：platform sync --spec-dir 指向不存在根仍报成功（flag 被忽略）；本仓 .sillyspec-platform.json specRoot=b97f8231 与本仓 junction（29f4a6d1）不符

## 适用条件
平台模式（platform connect 已配置）；离线纯本地仓不适用，但条目滞留风险同样存在。

---
> This is a proposed knowledge entry. Review and merge into manual/ or generated/.