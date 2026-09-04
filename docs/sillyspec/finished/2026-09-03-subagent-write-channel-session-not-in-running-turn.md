# 子代理写入通道故障：session not in running turn

- 发现：2026-09-03（2026-09-02-changes-overview-card 变更 plan 阶段 TaskCard 批量生成时）
- 状态：活跃（当日自愈路径已验证：主会话代写）

## 现象

并行 TaskCard 填充子代理（4 个 batch）中，子代理会话内一切**变更类**工具调用——Edit（多次）、Write、Bash 的 mkdir/touch/重定向/python/sed -i——统一报错 **"session not in running turn"**。特征：

1. **平台/审批通道层故障，非策略拒绝**——策略拒绝（如 /tmp 写入）有明确 Runtime Policy 消息，此错误无策略理由且发生在命令执行前。
2. **读类调用全部正常**（Read/Grep/Glob/只读 Bash）。
3. **等待无效**——batch C 子代理间隔重试约 8 分钟未恢复；batch D 的回退探测会话确认 Edit 与写路径 Bash 均被拦，"该会话已无法通过任何机制执行编辑"。
4. **主会话不受影响**——同一时间主会话 Edit/Write/Bash 写路径全部正常（已实证：主会话代为落盘 5 张卡片全成功）。
5. **无副作用**——被拒写入均未发生（临时文件未创建、目标文件保持原状、git status 干净），fail-closed 行为正确。

## 影响

子代理「调研成功但产物无法落盘」——工作白做一半，需主会话人工代写恢复。

## 自愈路径（已验证）

- 子代理在结果报告中**带回完整填充内容**（含精确 old_string/新块 YAML），主会话逐卡 Edit 套用——batch C 三卡 + task-08 主会话自填，全部成功。
- 主代理派工 prompt 中要求「完成后返回 allowed_paths 摘要」间接救了场——建议今后批量派工 prompt 一律加「若写入失败，将完整产物内容以可直接 Edit 套用的形式带回」。

## 待确认

- 触发条件不明（4 个同时启动的并行子代理全部命中，当日主会话正常——疑似子代理会话审批通道的间歇性平台故障）。
- 复现样本：会话 9e13677e（2026-09-03 08:46 前后），子代理 task-id a1069eeadcb4fce96（batch C）与 aa270a2647dbe0335（batch D 回退探测）。

## 进展更新（2026-09-03 13:30-13:50）

- **故障蔓延到主会话**：Wave 2 落盘时主会话 Edit/Write/Bash 写路径（含 python 直写）全部同报 "session not in running turn"（读类正常）；新派短命子代理（等待 30s 重试）同样全灭——确认平台级、跨会话类型。
- **自愈确认**：约 30 分钟后主会话写通道自行恢复（写探测探针验证通过），恢复后无需任何特殊操作，连续完成 24 处 Edit + 2 组 verify 全部正常。
- **恢复策略修订**（替代原「主会话代写」单一预案）：
  1. 首选：子代理带回内容 + 主会话代写（原预案，适用于只有子代理沦陷）；
  2. 主会话也沦陷时：**等待自愈**（实测 ~30 分钟恢复，无需人工干预），恢复后用无害写探针（echo > 临时文件 + rm）确认再续作；
  3. fail-closed 全程零副作用已再次实证（故障期间所有被拒写入均未发生，文件保持原状）。
- Wave 2 全部产出（22 条 Edit + 2 个 P0 缺陷修复）在通道恢复后零损失落盘，verify 全绿（89+108 passed）。

## 处置记录（2026-09-04 定时收口，根因高置信定位 + 防复发修复落地）

**根因候选锁定（高置信，与全部事故特征吻合）**：daemon `session-manager.ts` inject 入口的 stale-running 自愈（2026-08-27 P0：`>60s 无 result 即强翻 running→active`，治服务器重启死锁）会**误伤仍活着但安静的长 turn**——长时间无流式回调的工具执行（npm test/长思考/后台等待）触发翻转后，旧 turn 的所有写类工具调用（canUseTool 守卫要求 `status==='running'`）统一撞 "session not in running turn"。吻合点：①读类不走 canUseTool 全正常；②平台级跨会话类型（同一翻转逻辑）；③fail-closed 零副作用；④~30 分钟自愈 = turn 真正结束/新 inject 起 run 后 status 回 running，无需人工干预；⑤触发条件"不明" = 启发式误翻无任何日志线索（裸文案）。

**修复（sillyhub-daemon `src/interactive/session-manager.ts` + `types.ts`，工作区未提交）**：
1. **stale-flip 宽限**：翻转时记 `staleRunResetAt` 且不清 `currentRunId`（正常 result 收尾才清——两态可区分）；写通道守卫（`_writeChannelGuardDeny`，`_requestPermission` 与 `_buildCanUseToolCallback` 共用）在「active + currentRunId 仍在 + 翻转 60min 内」放行写调用——误翻是启发式猜测，写通道不该被猜测封锁；SDK 真死时本就无调用进来，宽限零额外风险。正常收尾路径（currentRunId=undefined）不受宽限影响，fail-closed 语义不变。
2. **诊断化拒绝**：deny message 从裸文案升级为携带 `status / currentRunId set/unset / staleRunReset 距今 / lastActive 距今`——事故排查时零线索的问题不再，若再现有真异因（如 daemon 重启 state 丢失）可直接从 message 判别。

**测试证据**：`tests/interactive/claude-sdk-driver-permission.test.ts` 新增 3 用例（宽限窗内放行进正常审批流并 allow、窗外 fail-closed 且含 staleRunReset 诊断、正常收尾态含完整诊断），14/14 全过；`tsc --noEmit` 0 错；dist 已重建。全量套件另有 `session-plan-bash-events.test.ts` 14 个**既有失败**（摘除法归因：去掉本轮改动同样失败，系他人已提交工作引入），与本修复无关。

**遗留**：原始事故无法回放实证（daemon 日志盲区），根因定性为"高置信候选"而非铁证——若复发，新诊断消息将直接给出判别证据；批量派工 prompt 携带「写入失败则带回完整产物内容」的自愈建议已记录在案（本文件自愈路径节）。
