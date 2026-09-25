---
author: flow-machine-draft
created_at: 2026-09-25T23:20:26.153Z
---
# 提案书（Proposal）— 2026-09-26-daemon-hits-periodic-upload

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:ac24cbd8e8354f5751ed11db5eaeae21be8d42e1c656e1aae050a8a0b58dc845:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-daemon-hits-periodic-upload 留痕重锚 -->
任务原话转写：动机：daemon 知识命中上行钩子只挂在 postSpecSync 成功汇聚点——spec 同步一失败遥测就全断（2026-09-25 生产实证：两工作区各断 4-5 天无人察觉，data_until 上线后才可见）。服务端行级 hash 幂等、重报免费，上行没有理由与同步成败耦合。

成功标准：
- hits 上行从 postSpecSync 汇聚点解耦为独立周期通道：daemon 主循环（或 heartbeat 节拍）每 5 分钟对已绑定工作区触发一次 uploadKnowledgeHitsIfNeeded（best-effort 语义不变：失败只 warn 不抛、断点不进）
- 触发器带 mtime 短路：hits 文件 mtime/size 与上次触发时相同则跳过整轮（避免每 5 分钟全量读 2MB+ 文件）
- 既有 postSpecSync 挂点保留（双通道幂等，服务端 hash 去重兜底；同步后即时上行 + 周期兜底双保险）
- 单测：周期触发调用 uploader（mtime 变化才调）；mtime 未变不调；端点失败不抛且周期定时器不中断
- 既有 daemon hits 上行测试与 typecheck 零回归
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:0e5d3c208fbc40eda57648c756fd6eed3c22258cb7396c90e1e11146f9befb44:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-daemon-hits-periodic-upload 留痕重锚 -->
按成功标准机械推导，共 9 条验收面：
1. hits 上行从 postSpecSync 汇聚点解耦为独立周期通道：daemon 主循环（或 heartbeat 节拍）每 5 分钟对已绑定工作区触发一次 uploadKnowledgeHitsIfNeeded（best-effort 语义不变：失败只 warn 不抛、断点不进）
2. 触发器带 mtime 短路：hits 文件 mtime
3. size 与上次触发时相同则跳过整轮（避免每 5 分钟全量读 2MB+ 文件）
4. 既有 postSpecSync 挂点保留（双通道幂等，服务端 hash 去重兜底
5. 同步后即时上行 + 周期兜底双保险）
6. 单测：周期触发调用 uploader（mtime 变化才调）
7. mtime 未变不调
8. 端点失败不抛且周期定时器不中断
9. 既有 daemon hits 上行测试与 typecheck 零回归
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:bb8c417119c6d206fc43b1f270b96e712efc8a4eb79db6c0d19c2af6b232c8c7:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-daemon-hits-periodic-upload 留痕重锚 -->
1. hits 上行从 postSpecSync 汇聚点解耦为独立周期通道：daemon 主循环（或 heartbeat 节拍）每 5 分钟对已绑定工作区触发一次 uploadKnowledgeHitsIfNeeded（best-effort 语义不变：失败只 warn 不抛、断点不进）
2. 触发器带 mtime 短路：hits 文件 mtime
3. size 与上次触发时相同则跳过整轮（避免每 5 分钟全量读 2MB+ 文件）
4. 既有 postSpecSync 挂点保留（双通道幂等，服务端 hash 去重兜底
5. 同步后即时上行 + 周期兜底双保险）
6. 单测：周期触发调用 uploader（mtime 变化才调）
7. mtime 未变不调
8. 端点失败不抛且周期定时器不中断
9. 既有 daemon hits 上行测试与 typecheck 零回归
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
