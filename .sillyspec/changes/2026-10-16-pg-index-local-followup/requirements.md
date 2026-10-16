---
author: flow-machine-draft
created_at: 2026-10-16T01:42:37.296Z
---
# 需求规格（Requirements）— 2026-10-16-pg-index-local-followup

## 功能需求

### FR-01: .sillyspec/knowledge/uncategorized.md 新增补记小节，覆盖本地 12/360 无重复行直接 REINDEX、amcheck 须 JOIN pg_am 过滤 btree、last_used_at 停滞即同步静默断档信号、墓碑冲突遗留待拍板，四点齐全

- 必须：新增小节一次性覆盖四点——①本地 docker 平台 btree 12/360 坏且全部唯一索引零重复行、免去重直接 REINDEX 即愈（与生产 18 坏+8 幻影行需备份去重的分支对照）；②amcheck 全库扫描必须 JOIN pg_am 过滤 btree 索引（GIN/*_trgm 会被 bt_index_check 报错误计为坏，本地首扫 29 假 17 真）；③platform_sync_tokens.last_used_at 长期停滞 = 同步静默断档信号（工作转移到生产侧后本地平台断粮，区别于 422 失败路径）；④2026-09-08-session-turn-nav 平台删除墓碑与本地 archive 文件冲突遗留待用户拍板（manifest-heal 恢复或 tombstone_cleanup 接受删除）。

#### 场景：补记四点齐全

- Given .sillyspec/knowledge/uncategorized.md 已含 2026-10-16 生产事故条目
- When 追加本地复发补记小节
- Then 小节内可检索到 12/360、REINDEX、pg_am（或 btree 过滤）、last_used_at、session-turn-nav 五组关键词，四点内容齐全

### FR-02: 补记紧邻既有 2026-10-16 生产事故条目且不改动原条目内容

- 禁止：改动既有生产事故条目的任何文字；变更只允许在文件末尾追加新小节（原条目是文件最后一个小节，末尾追加即天然紧邻其后）。

#### 场景：原条目零改动

- Given 生产事故条目已存在于文件末尾
- When 提交补记
- Then git diff 对原条目所在行区间零改动，全部新增行位于其后

### FR-03: 数字与本次实证一致：360 checked/12 bad/修复后 0 bad、清单 10152 到 10680 行、变更行 614

- 必须：补记中出现的实证数字与 2026-10-16 本地修复实测一致——amcheck 修复前 checked=360 / bad=12（btree 口径）、修复后 checked=360 / bad=0；spec_file_manifest 行数 10152→10680；changes 表全量 614 行；禁止编造或漂移。

#### 场景：数字一致

- When 阅读补记小节
- Then 上述五处数字与修复会话实测输出一致

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯知识文档追加无代码行为面；四点齐全由 task-02 的关键词 grep 自检与 flow done 文档校验门承载
FR-02: 不适用：原条目零改动由 git diff 提交面直接可验，无自动化测试面
FR-03: 不适用：数字一致性属文档内容核对，无代码路径可测
