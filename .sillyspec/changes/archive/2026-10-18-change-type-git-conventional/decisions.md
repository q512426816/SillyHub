---
author: flow-machine-draft
created_at: 2026-10-18T13:08:29.206Z
---
# 决策记录（Decisions）— 2026-10-18-change-type-git-conventional

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：提交归属误判。两类实证坑已堵——① 跨变更引用（提交信息正文提及评审 出处变更 key）：按「信息中**最后一个** key 形态 token」归属，不按出现过即归属； ② CLI 基线检查点提交 `sillyspec: baseline checkpoint for <key> …` 的 `sillyspec:` 撞 conventional 前缀正则：类型白名单（feat/fix/perf/refactor/test/docs/style/ build/ci/chore/revert）外一律不认。残余面：变更唯一提及在 release-notes 类提交 里 → 归 docs（可接受，此类变更本就是文档面）；老变更提交不带 key（215 个 no_match）→ 不猜不写，保持现状显示。 试过放弃：A. 平台侧解析 timeline.md 提交锚——主提交只有裸哈希无标题，判不出 fix（实证：session-envelope 会错判 docs）；B. 标题/动机关键词推导——「防迟到旧值 覆盖」类中文概括无稳定关键词，猜错比不猜伤害大；C. 新增平台端点直写类型——要动 鉴权/审计面，而 spec-sync 镜像通道现成且 reparse 已消费该目录。
