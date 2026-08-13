---
author: qinyi
created_at: 2026-08-13 11:30:00
---

# 决策台账 — 2026-08-13-platform-managed-file-sync

本次变更的决策台账（不是长期术语表）。只记录有实现/验收影响的决策。

## D-001@v1: 并发模型 = 多写者 + 乐观锁
- type: architecture
- status: accepted
- source: user
- question: 多用户/设备对应同一 workspace 时，文件推送用哪种并发模型？
- answer: 多写者 + 乐观锁。多人可改，推时带 base_version，过期推被 409 拒 + 返回服务器版，人工拍板。不同人改不同文件互不干扰，同文件被过期推拦下。
- normalized_requirement: 推送请求必须带 base_version；服务器比对不符返 409 + 返回服务器当前版本；不做自动合并。
- impacts: [FR-01, FR-02, FR-03]
- evidence: 用户 AskUserQuestion 选择「多写者+乐观锁」
- priority: P0

## D-002@v1: 删除传播 = 同步删除（软删除留备份 + 锁保护）
- type: boundary
- status: accepted
- source: user
- question: 多写者+乐观锁下，本地删除的文件要不要同步到服务器？
- answer: 同步删除，但**服务器不物理删除——移入备份区保留历史**（可找回），且靠乐观锁/base_version 保护——同一文件别人改过就被 409 拒（提示冲突先拉），避免误删。
- normalized_requirement: delete op 带 base_version 校验；过期删除被 409 拒；服务器执行软删除（移备份区/归档，保留历史版本），不物理删 spec_root 文件。
- impacts: [FR-04]
- evidence: 用户 AskUserQuestion 选择「同步删除(带锁保护)」+ 追问「文件删除要留备份哦（服务器上不能真删）」
- priority: P0

## D-003@v1: 内容 hash = SHA-256
- type: architecture
- status: accepted
- source: code + 常识
- question: 文件内容 hash 用哪个算法？
- answer: SHA-256。MD5 碰撞攻击成熟（2004 年起），文件身份判断不可靠；SHA-256 无实际碰撞风险，性能微秒级可忽略。服务器 `_write_spec_root` 现也已用 SHA-256 content_hash（service.py:634）。
- normalized_requirement: 文件级增量同步用 SHA-256 内容 hash。
- impacts: [FR-05]
- evidence: `service.py:634` content_hash=SHA-256；MD5 已知不安全
- priority: P0

## D-004@v1: 乐观锁粒度 = 文件级版本
- type: architecture
- status: accepted
- source: user
- question: 乐观锁用文件级版本还是整树版本？
- answer: 文件级版本。每文件一个版本号，推送按文件比对自己的 base_version。不同文件互不冲突，同一文件被过期推拦下。更精准，需服务器存每文件版本（新增清单存储）。
- normalized_requirement: 服务器维护逐文件版本号；推送按文件比对 base_version。
- impacts: [FR-01, FR-06]
- evidence: 用户 AskUserQuestion 选择「文件级版本」
- priority: P0

## D-005@v1: rename 显式 op
- type: architecture
- status: accepted
- source: code（Spike）
- question: 文件路径变化（rename）怎么处理？
- answer: 增量模型下 rename 失守（整树+旧文件保留掩盖了它，reparse 靠目录缺失探测）。需显式推 `rename {old, new}` op + 服务器删旧路径，且旧文件 hash 相同不重传内容。
- normalized_requirement: 增量 payload 支持 rename op（old_path, new_path, hash）；服务器执行 rename 并更新清单。
- impacts: [FR-07]
- evidence: Spike Q5.1
- priority: P0

## D-006@v1: .runtime/ 移出增量同步范围
- type: architecture
- status: accepted
- source: code（Spike）
- question: `.runtime/`（含 sillyspec.db）要不要一起增量同步？
- answer: 移出增量范围。现状 postSpecSync 整树含 `.runtime/`，服务器给 `.runtime/*` 建垃圾 ScanDocument 行（service.py:663-676 无过滤），但 reparse 从不读它（parser 明确"平台读不到 db，用文档推断"）、build_bundle 也排除。纯负担。
- normalized_requirement: 增量 payload 排除 `.runtime/`；不做 `.runtime/` 增量同步。
- impacts: [FR-08, 兼容策略]
- evidence: Spike Q5.3 + `service.py:663-676`
- priority: P1

## D-007@v1: 方案 = 复用 scan_documents 清单 + JSON ops 增量端点
- type: architecture
- status: accepted
- source: user
- question: 增量同步选哪个实现方案？
- answer: 方案 A。复用 `scan_documents` 作清单基线（已有 path + content_hash），补文件级版本号列；新端点 JSON ops（add/update/delete/rename + base_version）天然表达；旧 tar 端点保留做首同步/回退。
- normalized_requirement: 增量端点接收 JSON ops；scan_documents 作清单；旧 tar 端点保留。
- impacts: [FR-01, FR-07, §5]
- evidence: 用户 AskUserQuestion 选择「方案A」
- priority: P0

## D-008@v1: 软删除备份位置 = 服务器 spec_root 下备份区（.trash/）
- type: architecture
- status: accepted
- source: user
- question: 删除的文件备份放哪？
- answer: 服务器 spec_root 下备份区（如 `spec_root/.trash/<timestamp>-<path>` 或归档目录），保留历史可找回，不物理删 spec_root 原文件。
- normalized_requirement: delete op 将文件移 `.trash/` 备份区 + 清单 exists=false。
- impacts: [FR-04, §7 软删语义]
- evidence: 用户要求「文件删除要留备份（服务器上不能真删）」
- priority: P0

## D-009@v1: 清单复用 scan_documents（已废弃）
- type: architecture
- status: superseded（被 D-011@v1 取代）
- source: code（Spike）
- question: 服务器权威清单存哪？
- answer: 原计划复用 `scan_documents` 表加 version 列。Design Grill BL-1 证伪：scan_docs reparse 只认 docs/，会把非 docs 行的 exists 翻转，复用会失真。
- impacts: [FR-03] → 由 D-011 承担
- evidence: Design Grill BL-1 + `scan_docs/service.py:199-203`
- priority: P0

## D-010@v1: 软删明确为 move（服务端真移）+ apply_ops 定义 exists 语义
- type: architecture
- status: accepted
- source: code（Design Grill BL-3）
- question: 软删除是 move 还是 copy？exists=false 语义归谁？
- answer: 软删 = move（磁盘 spec_root 原路径真移走，reparse 自然看不到）；`spec_file_manifest.exists=false` 由增量端点唯一写，scan_docs reparse 不碰此表 → 无"真删 vs 陈旧"歧义。取舍：软删后备份区仅恢复文件，不恢复 Change 行工作流状态（reparse 硬删）。
- normalized_requirement: delete op 移文件出 spec_root + spec_file_manifest.exists=false + version+1；scan_docs reparse 不写 spec_file_manifest。
- impacts: [FR-04, §7, R-04]
- evidence: Design Grill BL-3 + `change/service.py:1140` reparse 硬删
- priority: P0

## D-011@v1: 清单用独立 spec_file_manifest 表（不复用 scan_documents）
- type: architecture
- status: accepted
- source: code（Design Grill BL-1）
- question: 增量清单存哪，避免与 scan_docs reparse 互扰？
- answer: 新建独立 `spec_file_manifest` 表（path/content_hash/version/exists/updated_at），增量端点唯一写者，scan_docs reparse 不碰。职责分离：scan_documents=docs 扫描产物，spec_file_manifest=增量同步清单。
- normalized_requirement: 建 spec_file_manifest 表 + migration；增量端点读写；scan_docs reparse 不写。
- impacts: [FR-03, §6, §8, R-08]
- evidence: Design Grill BL-1（scan_docs reparse 翻转非 docs 行）
- priority: P0
