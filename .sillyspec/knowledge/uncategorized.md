# 未分类知识

> 项目特定的架构经验、历史记录、尚未提炼成通用 pattern 的知识。
> 已分类的迁移到：`sillyspec-gotchas.md`（工具坑）/ `testing-gotchas.md`（测试坑）/ `patterns.md`（架构）/ `known-issues.md`（项目坑）/ `conventions.md`（约定）。
> 已修复项保留并标注状态，便于回溯。INDEX.md 不索引本文件——条目成熟后请迁出到分类文件并加 INDEX 索引。

（2026-09-28 清账：本文件原有 41 条（40 个 `##` 条目 + 1 条丢标题的 SSE 路由条目）已全部迁出到五个分类文件并在 INDEX.md 补索引，见变更 2026-09-28-knowledge-inbox-clear。）

（2026-10-19 清账：本轮积压 16 条已全部迁出并在 INDEX.md 补索引——testing-gotchas 4 / known-issues 6 / conventions 3 / sillyspec-gotchas 2 / patterns 1，见变更 2026-10-19-knowledge-inbox-triage。4 条【待确认】逐条裁决留痕：daemon.start() 系统代理黑洞属实（推广待立项）、MissingGreenlet 已修（patterns）、require_permission 422 属实现行约束（known-issues 🟡）、.zcode 已跟踪文件属库存量状态（known-issues 🟡）；已修复项按 🟢/🟡 口径标注（生产嵌入定案 🟢、生产/本地索引损坏 🟢、首搜建库地雷 🟡 等）。另清掉 1 条已完成迁移的历史面包屑（fake timers waitFor）。当前收件箱为空，新踩坑从下方追加。）

## 对话轮 daemon_task_leases 为会话级绑定，run 维度查 lease 必为 0 行

daemon_task_leases 中交互对话轮的 lease 不写 agent_run_id（NULL，会话级绑定，见 backend/tests/modules/daemon/test_start_stage_dispatch_transport.py:505 注释与 router 建行代码）；只有任务型 run（mission/task 派发）才按 run 维度建 lease。因此任何「按 agent_run_id 查 lease → 查 runtime → 查 daemon 实例」的活性判定链（如 agent/service.py `_run_daemon_alive`）对对话轮天然返回「链路不可解析 None」——不能把 None 当「daemon 死亡」直接判死，必须另有兜底信号（日志 askwait/心跳等）。2026-10-26 生产实证会话 388bb823（run 3b601319）：AskUserQuestion 等待用户回答 + 无 lease + 日志停滞，被复扫链按纯 recency 误判 SERVICE_RESTART_INTERRUPTED（修复=2026-10-26-session-stage-progress task-06 复扫 askwait 豁免，D-014）。（来源：task-06）
