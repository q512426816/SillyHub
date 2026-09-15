# quick 启动被平台同步阻塞 + --file-notes 后置生效预告缺失 + QUICKLOG 共享文件提交夹带 + ql-ID 预留/分配竞态（活跃坑）

> 实证会话：2026-09-13~14，24h 审查风险修复批第三轮（ql-20260913-003-4ee3，quick 会话 quick-72fca0c3 全程 + 登记会话 quick-86da7207 启动再次实证坑 1）；坑 4 实证会话 quick-89596588（ql-20260914-001-b14c）。
> 四个问题多会同场爆发，分开记录便于工具侧逐个修。

## 坑 1：quick 启动命令被平台同步网络阻塞，exec 超时但会话实际已建立

- 现象：`sillyspec run quick --input ... --non-interactive` 在 exec 工具 126s 超时被杀（本会话 2026-09-13 07:3x 实证一次超时、一次成功但尾部明显拖慢）；超时输出尾部可见 `[agent-log-push] → HTTP 502（本地产物已落盘兜底）` 与 `[spec-sync]` 动作。超时后会话**其实已建立**——`sillyspec run quick --status` 能查到，`.sillyspec/.runtime/quick-sessions/<id>/guard.json` 完整（allowedFiles/baseline/hash 齐全）。本登记会话启动尾部又现 `[spec-sync] 同步异常……平台响应慢，本轮同步被总预算熔断让路`——总预算熔断存在但预算上限本身已到分钟级。
- 环境：`.sillyspec/local.yaml` 配了 mcp/platform 段（平台当时 HTTP 502/响应慢），Git Bash exec 默认 120s+ 量级超时。
- 影响：非交互场景（CI/脚本/agent 驱动）下启动成败不可判；调用方超时后不知会话已建，按直觉重跑 `run quick` 会开新会话——正好制造 skill 文档警告的「误启动空壳会话」（QUICKLOG 残留 `(quick 任务)` 骨架需手动清）。
- 绕过（本轮实证）：超时后先 `sillyspec run quick --status` 查最新会话 ID，或直接读 `.sillyspec/.runtime/quick-sessions/` 最新目录的 guard.json 确认 allowedFiles 是否自己所传；已建则 `--change <id>` 续用，绝不重启。
- 建议工具修复：①agent-log push / spec-sync 等 best-effort 网络动作移出命令关键路径（已有「上报失败本地留底」语义，不该阻塞主流程返回）——会话 ID 与 step prompt 打印完成后即可返回，同步后台化或给 5-10s 短预算；②至少把同步总预算熔断的上限从分钟级压到秒级；③启动成功的第一行就打印 sessionId（现埋在长输出里），方便超时后核对。

## 坑 2：--file-notes 只随 step3 --done 生效，step2 提示词诱导先传、传完才警告

- 现象：step2 的 prompt 末尾照抄「完成后执行 `sillyspec run quick --done --change <id> --output "…"`」，无任何 --file-notes 时效预告；带 `--file-notes`（9 条文件括注）完成 step2 --done 后，CLI 尾部才警告「只随 step3 --done 同一命令传才生效……step1/step2 传无效」——先收下再丢弃再告知，先斩后奏。
- 影响：QUICKLOG 文件行括注静默丢失，需 step3 凭记忆重传一遍（本轮实证：9 条全部重传）；交互上让用户以为 step2 已落。
- 绕过：step3 --done 时重传（本次做法）；或干脆放弃 --file-notes 事后手改 QUICKLOG 文件行。
- 建议工具修复（三选一，按侵入度递增）：①step1/step2 的 --done 收到 --file-notes 直接拒绝（exit 非 0 + 指引），不做静默丢弃；②step2 prompt 尾部与 `run quick` 首次带 --file-notes 时前置预告；③step1/step2 接受并暂存到会话态（guard.json 或 .runtime），step3 --done 自动带上。

## 坑 3：多会话共享仓 QUICKLOG 文件级提交必夹带并行会话条目，无分离指引

- 现象：`--done` 把本会话 ql 条目追加进共享 `.sillyspec/quicklog/QUICKLOG-<user>.md`；该文件同时含并行会话的未提交条目（本轮 ql-20260913-003-4ee3 提交时 +40 行中含并行会话一条），文件级 `git add` 无法只暂存自己的 hunk。quick skill 文档对**源码文件**的同文件并发有完整分离指引（`git add -p` 交互选 hunk / `git diff > mine.patch` 定向 apply），对 QUICKLOG 这种追加式日志没有对应指引。
- 影响：本会话提交夹带他者已完成条目（条目自带 ql-ID 归属、最终收敛，无害但归属混乱、commit message 对账不准）；反向选择（等他者先提交）则自己的 ql 登记滞后于代码提交。
- 绕过：接受夹带（历史惯例，QUICKLOG 是 append 日志，按 ql-ID 可追溯）；或提交前 `git diff -- .sillyspec/quicklog/QUICKLOG-<user>.md` 人工确认夹带面并在 commit message 声明。
- 建议工具修复：①QUICKLOG 条目分片存储（如 `QUICKLOG.d/<ql-ID>.md` 独立文件、主文件聚合生成），提交天然按条目隔离；或 ②--done 输出本条目在 QUICKLOG 中的精确行号范围，供 `git diff | filter` / `git apply --cached` 定向暂存；或 ③skill 文档补 QUICKLOG 场景的分离指引（至少声明「夹带为既定惯例，无需分离」终结歧义）。

## 坑 4（2026-09-14 补登）：quick 会话启动预留 ql-ID 与最终分配竞态（同 ID 双发放）

- 现象：会话 quick-89596588（2026-09-13 启动）的 `.runtime/quick-sessions/<id>/guard.json` 预留 ql-ID `ql-20260913-007-1351`；但 QUICKLOG 里该 ID 被并行会话的条目「轮次刻度轨命中区修复」（2026-09-13 21:24:01 落盘）占用——同一 ID 发放给了两个会话；本会话 `--done` 时 CLI 最终分配 `ql-20260914-001-b14c`（跨零点新号）。guard.json 里的预留 ID 从此是 stale 值，无人回写。
- 影响：①按 skill 文档「ql-ID 可用于 design/模块文档引用」的指引，会话中途拿预留 ID 写进模块文档/QUICKLOG file-notes 会引用到**别人的条目**（本例实证：frontend.md 变更索引与 file-notes 先写了 007-1351，收尾时才发现要改成 b14c——若没核对就提交，检索会串条目）；②预留与最终不一致本身说明分配无查重，极端情况下两个 `--done` 可能争写同一 QUICKLOG 标题段。
- 绕过（本轮实证）：模块文档/QUICKLOG 引用 ql-ID 一律等 step3 `--done` 落盘后再写（CLI 打印的最终 ID 为准），会话中途只引用 quick-<hash> 会话号；收尾前 `grep` 一遍产出物里的 ql-ID 与 QUICKLOG 标题对账。
- 建议工具修复（sillyspec 仓，用户另行安排）：①分配 ql-ID 时对 QUICKLOG 已有 `## ql-...` 标题查重（占用即顺延取新号）；②`--done` 落最终 ID 时回写 guard.json 并校验预留 ID 未被他者占用，不一致打醒目警告。

## 处置进展

- 2026-09-13 登记（本文件）。三坑均为工具侧待修，无本地阻断（坑 1 有 status/guard.json 核对绕过、坑 2 有重传绕过、坑 3 有夹带惯例），不阻塞日常 quick 流程。
- 2026-09-14 补登坑 4（ql-ID 预留/分配竞态），同轮修正本仓数据善后：QUICKLOG ql-20260914-001-b14c 条目文件行引用的预留期旧 ID 007-1351 改回本条目 ID（时序根源与坑 2 同族——file-notes 传参时最终 ID 尚未分配）。坑 4 的工具代码修复由用户在 sillyspec 仓另行安排。
- **2026-09-14 坑 4 已修复（sillyspec 仓 commit `132d01d`，ql-20260914-003-4d6c）**：三层护栏——①分配查重：`collectGuardReservedQuicklogIds` 新导出，ql-ID 分配的 maxSeq 并入**他者活跃会话的 guard 预留**（7 天僵尸预留不钉号、盘上畸形头容错扫描、候选全 ID 末检 200 次兜底）；②`--done` 占用校验：盘上同 ID 条目 ≥2 fail-closed 硬拦，他者活跃 guard 仍预留同 ID 时本会话换新号完成（原 ID 让位、双方记录不混写）；③最终 ID 回写 guard.json，QUICKLOG 条目丢失场景由「硬拦请检查」降为原 ID 补建自愈。回归 `test/quicklog-ql-id-race.test.mjs` 25 断言 + 全量 463/463 绿。本机激活：全局 CLI 原安装（2026-09-13 22:02）早于修复提交不含修复（grep 新导出函数未命中实证），已从修复后本地源码重装并 grep 确认 Fix Active。坑 4 关闭；**坑 1/2/3 仍活跃**，本文件保持活跃位。

## 处置进展（2026-09-15 定时收口：坑2/坑1③/坑3 落地，坑1①② 留专项）

- **坑 2（--file-notes 先收后丢）已修复**：非末步 quick --done 带 --file-notes 由前置 warn 升级为**硬拒绝 exit 2**（拒绝文案含指引；被拒后去掉参数重跑不丢进度）——`src/run/command.js`；契约测试 `test/quick-filenotes-audit-hints.test.mjs` 更新（11/11 绿）。
- **坑 1③（sessionId 首行打印）已修复**：新会话 ID 生成即打印首行「📌 quick 会话已建立: <id>（后续若超时/中断，用 --change <id> 续用）」——排在 agent-log push / spec-sync 等网络动作之前，exec 超时也能从输出头拿到 ID。
- **坑 3（QUICKLOG 提交夹带）按建议③落地**：两仓 sillyspec-quick SKILL.md 声明既定惯例（夹带无害、ql-ID 归属对账、勿拆 hunk）+ 顺带声明坑 2 的硬拒绝行为。分片存储（建议①）与行号范围输出（建议②）留 backlog。
- **坑 1①②（网络动作移出关键路径 / 预算压秒级）留专项**：CLI 短进程内"后台化"需 detached 通道设计（浮动 promise 会因事件循环不空阻塞退出同理），总预算 threading 涉及全命令链路——属同步架构决策，非巡检级小修；坑 1③ 已消除主要操作性危害（超时可恢复）。
- 坑 4 已于 132d01d 修复（本文件 09-14 段已记）。**文件保持活跃（坑 1①② 余项）。**
