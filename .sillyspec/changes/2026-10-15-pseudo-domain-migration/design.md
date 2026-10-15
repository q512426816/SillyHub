---
author: flow-machine-draft
created_at: 2026-10-15T08:07:59.959Z
---
# 设计记录（Design Record）— 2026-10-15-pseudo-domain-migration

## 做法概述

用户指令「迁真域」的存量清偿面：sillyspec 仓 2026-10-15-module-path-glob-match 修复了模块路径 glob 匹配（扫描卡 146 条 glob paths 在全部归属判定点恒不命中——FR 铸伪域/决策落 unmapped 的根因），修复止增量；本变更清偿平台仓存量。

**判定链**（三条源依次兜底）：来源变更归档 design.md 交付表 → change-patch.json files → git log --grep 变更名 name-only 文件集（sillyspec 仓 frCoverageFiles 第三源同口径）→ 文件集经 modulePathMatches 对平台仓真实模块图（182 模块）求域 → 主域裁决规则（排除 test-utils 与一级聚合 frontend/backend/daemon/sillyhub-daemon → 具体域优先 → 命中文件数降序 → 名称长度降序；无具体域取聚合域）。人工改判两处留痕：deploy-script-version-echo-msys → deploy（机械误判 sillyspec，交付核心是 deploy/scripts；sillyspec(4) 为 .claude/skills 杂项误吸）；release-notes-server-sync → deploy_records（机械给 docs，跟随平台仓既有先例 auto-backend→deploy_records 迁发布记录条目）。

**FR 面**：92 条 auto-* 逐批 redomain --write（22 批）+ fr/unmapped 8 条（横断变更 2026-10-10-live-token-speed-daemon-timing 逐条按主题 anchor 迁移：三引擎计时→interactive、usage 契约→types、backend 提取/tokens SSE→daemon、前端显示→components-daemon、测试→frontend_components）。

**决策面**（442 段，工具= sillyspec 仓 2026-10-15-decision-redomain 新交付）：先数据修复三类脏段（①1 个粘连段：gov-action-stderr-noise 条目丢标题粘在上段尾部——补标题分拆；②3 个完全重复段：同 id 同变更幂等残留——去重；③4 行无主残迹：7b2c hash + 「过滤依赖」理由行不在归档真相源——剥离；修复经归档 decisions.md 核验，EOL 保真 CRLF）；然后 270 批 by-change（主域规则同 FR 面）+ 3 批 anchor（7 月早期变更无交付工件：rbac-permission-cache→auth 6 条、session-user-preamble→interactive 6 条、6 条无变更条目按主题 daemon 迁出）迁出 436 条；unmapped.md 空壳删除、INDEX 失效行自动清。

## 接口契约

- 纯知识数据变更（.sillyspec/knowledge/**），无代码面。迁移工具契约见 sillyspec 仓 src/redomain.js（FR 面）/ src/decision-redomain.js（决策面）——迁域不换号、段字节保真。
- 消费面变化：FR/决策按域落位后，知识注入（触达域路由）命中恢复；图节点 id（decision:<file>#…）随 file 变化为预期（引用形态「变更名#D-xxx@vN」不含 file）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：不适用——迁移为一次性批处理，批间由工具幂等收敛。
2. 并发写：平台仓多会话并行（提交面已显式 pathspec 隔离）；知识文件本变更单点写。
3. 切换/生命周期：迁移中途中断可重跑（已迁段不在源，批自然收敛）；unmapped 空壳删除后重跑拒（幂等）。
4. 作用域：知识库本仓；平台侧 spec 镜像随 sync 上行（决策深链 spec_path 随重建刷新——旧 file 路径深链失效为预期，用户可见面）。

## 风险与死路

最大风险：主域机械裁决的错分（如 ci-recurrence-guard 横断变更落 frontend_components 而非 CI 语义域）——接受：规则与触达路由同源（判定集含 frontend_components 时注入必达），横断变更多域命中下无唯一正确解；人工改判两处已在案。次风险：6 条无变更条目主题判域 daemon 属人工判断——留痕可复议。第三风险：坏段/重复段修复属数据手术——归档真相源核验+段字节级操作+validate ok+git 留痕四重保护。放弃方案：①按条目语义逐条人工判域（436 条不可行）；②保持 unmapped 只设基线消音（用户明示迁真域）；③重蒸馏迁移（归档源改不动）。
