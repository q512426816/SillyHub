---
author: flow-machine-draft
created_at: 2026-09-25T12:38:54.862Z
---
# 需求规格（Requirements）— 2026-09-25-full-sync-resurrect-missing

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: 同内容跳过须以「磁盘在位 + 行在线」为前提

- Given：全量同步逐文件循环，命中既有 scan_documents 行
- When：行内容哈希与 tar 成员相同
- Then：仅当目标文件磁盘在位且行 exists=True 才跳过；否则按复活态处理

### FR-02: 复活态落盘语义

- Given：磁盘缺文件或行软删（幽灵态）
- When：处理该 tar 成员
- Then：不参与 mtime 优越性判定，直接落盘（move）并把行翻回 exists=True；内容一致时不产生冲突归档行，内容不同仍走既有归档

### FR-03: 正常态零回归

- Given：哈希相同 + 磁盘已有 + 行在线（正常跳过态）
- When：全量同步处理该成员
- Then：仍然跳过——文件不被 move（mtime 不变），行为与改动前逐字一致

### FR-04: 单测覆盖三态

- Given：幽灵软删行 / 磁盘缺文件（行在线）/ 正常跳过三种形态
- When：跑 test_full_sync_convergence.py
- Then：分别断言：文件落盘 / 文件落盘且零冲突归档行 / 文件 mtime 不变

### FR-05: 幽灵软删行用例

- Given：行 exists=False + 哈希相同 + 磁盘缺文件
- When：全量同步该成员
- Then：文件落盘（行 exists 由 reparse 阶段按 docs/ 域语义管理，不在断言面）

### FR-06: 磁盘缺文件（行在线）用例

- Given：行在线 + 哈希相同 + 磁盘缺文件 + 行 mtime 很旧
- When：全量同步该成员
- Then：文件落盘且零冲突归档行（复活不比 mtime、同内容不归档）

### FR-07: 正常跳过态零回归用例

- Given：哈希相同 + 磁盘已有 + 行在线
- When：全量同步该成员
- Then：文件 mtime 保持原值（未被 move 重写）

### FR-08: 模块零回归

- Given：spec_workspace 模块既有用例（含全量收敛/墓碑/增量/chunk 等 155 个）
- When：定向跑模块测试
- Then：全绿（当前 158 passed 1 skipped = 基线 155 + 新 3；skip 为既有 Windows symlink 平台跳过）
<!--
参考摘录（非约束——agent 可采纳/改写/忽略；每条格式 ### FR-NN: 标题 + Given/When/Then）
FR-01: 同内容跳过分支增加「磁盘已有该文件且行在线（exists=True）」前提
FR-02: 磁盘缺失或行软删时按复活语义落盘（move 文件 + 行翻回 exists=True），不再要求 mtime 更新才写
FR-03: 复活时内容一致的文件不产生冲突归档行（内容相同无冲突可言）
FR-04: 内容不同仍走既有冲突归档
FR-05: 新增单测：①幽灵软删行（exists=False 且哈希相同）+ 磁盘缺文件 → 落盘且行翻回在线
FR-06: ②磁盘缺文件但哈希相同（行在线）→ 落盘
FR-07: ③正常「哈希相同且磁盘已有」仍跳过（零回归钉死）
FR-08: 既有 spec_workspace 全量同步测试零回归
-->


## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_full_sync_convergence.py::TestResurrectMissingFiles 三个用例共用该前提（跳过分支仅正常态命中）


<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_full_sync_convergence.py::test_ghost_soft_deleted_row_same_hash_resurrects + test_disk_missing_row_online_same_hash_resurrects（后者断言零冲突归档行）


<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_full_sync_convergence.py::test_same_hash_and_disk_present_still_skips（mtime 钉死不变）


<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_full_sync_convergence.py::TestResurrectMissingFiles 三用例


<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_full_sync_convergence.py::test_ghost_soft_deleted_row_same_hash_resurrects


<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_full_sync_convergence.py::test_disk_missing_row_online_same_hash_resurrects


<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_full_sync_convergence.py::test_same_hash_and_disk_present_still_skips


<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向回归命令 cd backend && uv run pytest app/modules/spec_workspace -q --no-cov（158 passed 1 skipped；基线 155）

