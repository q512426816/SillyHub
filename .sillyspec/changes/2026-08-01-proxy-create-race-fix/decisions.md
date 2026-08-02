---
author: qinyi
created_at: 2026-08-02 00:01:59
change: 2026-08-01-proxy-create-race-fix
---

# 决策台账 — proxy-create 并发竞态修复

## D-001@v2 — 方案 A 扩展：占坑 Change + 全部 ChangeDocument

- **type**: architecture
- **status**: accepted
- **supersedes**: D-001@v1
- **source**: design-grill（P0-1 修订）
- **question**: 方案 A「占坑 Change 行」只防了 changes 表，change_documents 表的同源并发（_sync_docs 与 proxy 步骤6 INSERT docs 撞 ux_change_docs_type_path）如何一并消除？
- **answer**: 占坑时同时 INSERT Change + 所有 files 对应的 ChangeDocument（exists=True），让 reparse 的 _apply_parsed 与 _sync_docs 两路都走 update；proxy 回执 done 后不再 INSERT docs（可选 UPDATE mtime）。
- **normalized_requirement**: 同一 change_key 与同一 (change_id,doc_type,path) 都不被两路并发写入；G1 真正达成。
- **impacts**: change_writer/proxy.py（时序重构，步骤3 建 Change+docs / 步骤6 不补 / 步骤7 CASCADE 回滚）；覆盖 G1
- **evidence**: migration 202605300900:99（ux_change_docs_type_path）；change/model.py:189；change/service.py:1150（_sync_docs INSERT）；proxy.py:186-309；task-runner.ts:2171-2184（先回执后 sync）
- **priority**: P0
- **理由**: 单建 Change 只占 changes 唯一键，docs 表竞态原封不动 → 500 换表复现；占坑建 docs 让 reparse _sync_docs 走 update（existing_docs 预取命中），双表并发同源消除。

## D-001@v1 — 方案 A：proxy 占坑 Change 行（已被 v2 取代）

- **type**: architecture
- **status**: superseded
- **source**: brainstorm step 4（用户选择）
- **question / answer**: proxy 下发前先 INSERT Change 占 change_key。
- **被取代原因**: Design Grill P0-1 指出只防 changes 表，遗漏 change_documents 表同源竞态。
- **priority**: P0

## D-002@v1 — 用 owner_id 区分 proxy/用户创建行

- **type**: design
- **status**: accepted
- **source**: brainstorm step 5 + design-grill（P1-1 显式化）
- **question**: reparse 如何避免覆盖 proxy 占坑行（及 worktree lease 行）的 current_stage？
- **answer**: `_apply_parsed` 仅当 `row.owner_id is None` 才覆盖 current_stage。proxy/worktree-lease 建行 owner_id 非空，受保护。
- **normalized_requirement**: proxy 落库 draft 不被 reparse 改 brainstorm；worktree lease 行 stage 由 dispatch/transition 权威，不被文件推断覆盖。
- **impacts**: change/service.py:1248；覆盖 G2；§9 显式承认 worktree lease 行为变化
- **evidence**: change/service.py:1227（_build_change owner_id=None）、160（worktree lease owner_id=user_id）、1248（_apply_parsed 覆盖条件）
- **priority**: P0
- **理由**: owner_id 现成列；扫描建行恒 None、proxy/worktree-lease 建行非 None，判据天然区分。worktree lease 行为变化（stage 不再被文件推断覆盖）语义更对（stage 应由 dispatch 权威），显式承认可接受。

## D-003@v1 — 中文 change_key unicode 正则 + .lower()

- **type**: design
- **status**: accepted
- **source**: brainstorm step 3 + design-grill（C4 补 .lower()）
- **question**: 中文标题被过滤成 untitled 怎么修？
- **answer**: `re.sub(r"[^\w]+","-",title.lower(),flags=re.UNICODE)`，保留中文/字母/数字（英文小写），剔除标点与 Windows 文件名非法字符。
- **normalized_requirement**: 中文标题 change_key 保留原文可读；英文大小写与 worktree lease 分支一致。
- **impacts**: change_writer/proxy.py:67-71；覆盖 G4
- **evidence**: proxy.py:67-71；service.py:117（worktree lease 用 title.lower()）
- **priority**: P1
- **理由**: \w+UNICODE 含中文；保留 .lower() 与 worktree lease 一致避免 Linux 大小写敏感异义目录；uuid 后缀保唯一。

## D-004@v1 — R-02 IntegrityError 防御落点

- **type**: design
- **status**: accepted
- **source**: design-grill（P1-2）
- **question**: 极端并发下 reparse created 撞 changes 唯一键的防御落在哪？
- **answer**: change/service.py `_reparse` created 分支 `_session.add(row)`（service.py:1066）外包 try/except IntegrityError → 回滚 add → 重查 existing_by_key → 走 _apply_parsed(update)。语义=撞键即转 update，不抛错。
- **normalized_requirement**: 极端并发下 reparse 不因撞键抛 500/致 sync_status 永久 dirty。
- **impacts**: change/service.py _reparse created 分支；§5 Phase 2b
- **evidence**: change/service.py:1066
- **priority**: P1
- **理由**: belt-and-suspenders（C2 证物理上几乎不可能撞）；落点明确在 _reparse created 处，与 apply_sync 阶段级 try/except 正交。

## D-005@v1 — 失败回滚幽灵变更策略

- **type**: boundary
- **status**: accepted
- **source**: design-grill（P1-3）
- **question**: daemon 写盘成功但回执丢失/超时 → proxy 删占坑行后，daemon 端 changes/<key>/ 残留导致下次 sync 重建幽灵变更，如何处理？
- **answer**: 本次不下发 daemon cleanup 任务（YAGNI，跨进程 + 概率低）；显式承认残留，幽灵行（owner_id=None/brainstorm + 无 daemon_change_write 关联）可识别后人工/脚本清理；change_key uuid 后缀不阻碍用户重试。
- **normalized_requirement**: 失败回滚不留 backend 孤儿；daemon 文件残留有明确登记与识别路径。
- **impacts**: §5 Phase 4 / R-01
- **evidence**: change/model.py FK CASCADE；daemon_change_writes 表
- **priority**: P2
- **理由**: 下发 cleanup 需改 daemon + 新 kind，成本高于收益；幽灵可识别可清理，不阻断功能。

## D-006@v1 — 竞态消除机制=占坑+串行；既有 doc_type 不一致不修

- **type**: architecture
- **status**: accepted
- **source**: design-grill 第二轮（R1/R7 修正）
- **question**: r2 论证「占坑 docs → reparse 走 update」经核实不成立（`proxy._build_files` doc_type `master/request` 与 parser `STANDARD_FILENAMES` key `MASTER/requirements` 不一致），竞态真实消除机制是什么？doc_type 不一致是否本次修？
- **answer**: (1) 竞态消除靠「占坑 Change 占住 changes 唯一键 + proxy 步骤6 不再 INSERT docs + reparse 单路串行写 docs」，与 proxy 路无并发（无论 update 或 DELETE+INSERT 都不撞键），**非「走 update」**。(2) 既有 doc_type 不一致（master/request vs MASTER/requirements）不导致 500，本次不修（碰 worktree-lease + request.md 语义超范围），登记 R-05 后续单独变更。
- **normalized_requirement**: G1 论证链条须与源码一致；范围控制不扩大到 doc_type 重构。
- **impacts**: design §5 Phase 1 论证 / Phase 5 测试断言 / R-05；proxy._build_files doc_type 不改
- **evidence**: proxy.py:100/111/121（doc_type master/proposal/request）；spec_paths.py:42-51（STANDARD_FILENAMES key MASTER/proposal/requirements）；service.py:1169-1186（_sync_docs update/INSERT/DELETE 分支）
- **priority**: P0（论证正确性）
- **理由**: r2 误判 update 致 Phase 5 断言与实际行为冲突；r3 修正为串行消除，测试断言改为「无并发唯一键冲突 + proxy 返回 docs 存在」。doc_type 重构是独立既有 bug，本次 YAGNI。
