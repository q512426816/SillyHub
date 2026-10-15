# verify-probes 预填噪音与 sillyspec commit 建议误判（输出质量小坑合集）

> 记录时间：2026-10-15 · 来源变更：2026-10-14-admin-server-status
> 状态：活跃坑（人工判读绕过，无阻断，待工具打磨）

## 坑 A：探针 3 预填的「归属测试文件」列表巨长噪音

verify-result.md 骨架的探针 3（验收标准测试覆盖）按 allowed_paths 目录递归找测试文件——
task-03 的 allowed_paths 含 `backend` 与 `frontend/src/lib` 两个宽目录，预填表格的
「归属测试文件」列塞进 **82 个测试文件名**（单行数千字符 ×3 行），task-04 也有 22 个。
矩阵表实际只需要真实归属的 1-2 个；预填列表把信号完全淹没，还撑爆 verify-result.md 体积。

### 修复建议
预填按「与 acceptance 关键词有命中的前 N（如 5）个」截断，其余折叠为
「+N 个目录级候选（略）」；目录级 allowed_paths 不递归整仓测试树。

## 坑 B：sillyspec commit 建议 message 类型误判

本变更暂存区含：execute 已勾 task×4 + archive 产物 + 模块卡 + knowledge——
`sillyspec commit` 建议了 `fix: quick 修复 + 阶段产出`：
- type 判成 fix（实为 feat——主体是四任务功能实现，明显误判）；
- 「quick 修复」描述凭空出现（本变更无任何 QUICKLOG 条目）；
- 四个「阶段产出」body 行重复无信息量。

实测以手写 message 提交绕过（0be62452f）。commit-suggest.js 的来源归类
疑似被并行会话的 quick 噪声/或 archive 产物主导，未按「最主要 type」正确加权。

### 修复建议
来源权重改为「execute 已勾 task 数 × 系数 > 阶段产物」；QUICKLOG 过滤窗口
核对其是否误把并行会话条目计入；body 行按来源去重合并。

## 坑 C：平台同步 409/熔断刷屏（低优先级）

spec-sync 对 crrcdt.ppdmq.top 的 POST 多次 409 conflict + 「平台响应慢，本轮同步被总预算熔断
让路」——best-effort 不阻断流程，但每条 CLI 命令尾部都带长串 409 JSON 噪音（含整段
platform_progress 回显，单条数百字符）。409 的自愈文案（「内容一致自愈重推」）说明平台端
有冲突消化逻辑，本地侧建议把 409 响应体折叠为一行摘要。

## 处置记录（2026-10-15）

**三坑全部已修**（sillyspec `2026-10-15-pitfall-batch-clearance`，归档 a493aef1）：

- **坑 A（探针 3 归属列表噪音）✅**：预填截断为前 5 + 「共 N 个（目录级候选全量在
  facts/trace）」折叠，路径经 mdEscapeCell 防竖线破表；
- **坑 B（commit 建议误判）✅**：quick 来源加锚「quicklog 文件属于本次提交变更集」
  （porcelain staged/unstaged/untracked），不在变更集的条目不参与建议；无 task 无 quick
  的归档/知识面提交按 chore 语义建议（不再凭空「fix: quick 修复」）；body 与 subject
  去重保留 qlId 审计锚（25/25 测试绿，含本坑回归钉）；
- **坑 C（409 响应体刷屏）✅**：非 2xx 回显折叠为一行摘要（conflict 标识 + 关键
  时间戳/变更字段），不再整段 platform_progress 挂命令尾部。

归档。
