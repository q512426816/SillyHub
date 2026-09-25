---
author: flow-machine-draft
created_at: 2026-09-25T09:50:43.825Z
---
# 提案书（Proposal）— 2026-09-25-daemon-hits-upload-fingerprint

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:d25d6d0af75ba8a19636bc1a84a78148afa4347aed0e61afc57838d6f78cb356:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-daemon-hits-upload-fingerprint 留痕重锚 -->
任务原话转写：动机：daemon 知识命中上行的断点是纯行数 offset（.hits-upload-state-{ws}.json 只记 uploadedLines）——文件被重置/替换后又长回或超过旧 offset 时，钳位不触发，新文件前 offset 行会被静默跳过、永久丢报（sillyspec 仓 2026-09-24 merge 清空 hits 文件的现实场景正是这类替换；等文件重新长过 3389 行该洞必然触发）。服务端本就有 (workspace_id, line_hash) 行级唯一约束，重报幂等零重复，行数口径没有理由不用指纹自愈。

成功标准：
- 断点状态在行数之外记录 tailHash（已上行最后一行的 sha256）；每批成功后随行数一起原子落盘
- 每轮上报前做指纹比对：行数未超前但「已上行最后一行」位置已是别的行 → 回退 offset=0 从头重报（服务端 hash 去重兜底），新文件前段不再被静默跳过
- 钳位分支（行数超前）语义不变：钳位轮零上行、立即固化，并随钳位重记指纹
- legacy 状态（无 tailHash）零误伤：该轮维持纯行数口径不整文件重报，首批成功后指纹开始落盘
- 新增单测：替换后长过旧 offset 全量重报+后续恢复增量、等长替换识别、legacy 状态不误报且指纹落盘
- 既有 hits 上行单测零回归（基线 14）+ pnpm typecheck 0 错
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:7bc918d1144ca295ee2e2ddf5a7c1b3eae7ebcbe154660b311f878f449aebc4f:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-daemon-hits-upload-fingerprint 留痕重锚 -->
按成功标准机械推导，共 7 条验收面：
1. 断点状态在行数之外记录 tailHash（已上行最后一行的 sha256）
2. 每批成功后随行数一起原子落盘
3. 每轮上报前做指纹比对：行数未超前但「已上行最后一行」位置已是别的行 → 回退 offset=0 从头重报（服务端 hash 去重兜底），新文件前段不再被静默跳过
4. 钳位分支（行数超前）语义不变：钳位轮零上行、立即固化，并随钳位重记指纹
5. legacy 状态（无 tailHash）零误伤：该轮维持纯行数口径不整文件重报，首批成功后指纹开始落盘
6. 新增单测：替换后长过旧 offset 全量重报+后续恢复增量、等长替换识别、legacy 状态不误报且指纹落盘
7. 既有 hits 上行单测零回归（基线 14）+ pnpm typecheck 0 错
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:8c3bd6ddb4c81216df6ed4e8e35c39ba6469d522bc326dae499b686ec27934d0:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-daemon-hits-upload-fingerprint 留痕重锚 -->
1. 断点状态在行数之外记录 tailHash（已上行最后一行的 sha256）
2. 每批成功后随行数一起原子落盘
3. 每轮上报前做指纹比对：行数未超前但「已上行最后一行」位置已是别的行 → 回退 offset=0 从头重报（服务端 hash 去重兜底），新文件前段不再被静默跳过
4. 钳位分支（行数超前）语义不变：钳位轮零上行、立即固化，并随钳位重记指纹
5. legacy 状态（无 tailHash）零误伤：该轮维持纯行数口径不整文件重报，首批成功后指纹开始落盘
6. 新增单测：替换后长过旧 offset 全量重报+后续恢复增量、等长替换识别、legacy 状态不误报且指纹落盘
7. 既有 hits 上行单测零回归（基线 14）+ pnpm typecheck 0 错
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
