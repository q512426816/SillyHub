---
author: flow-machine-draft
created_at: 2026-10-26T15:08:59.742Z
---
# 任务注册表（Tasks）— 2026-10-26-ci-red-to-green

- [x] task-01: e2e-ci.yml PG service 镜像 postgres:16-alpine→pgvector/pgvector:pg16（验证：yml diff 仅 image 行变更，与 deploy/docker-compose.yml 镜像口径一致）
- [x] task-02: daemon.ts reportTurnPhase 与 onTurnMessage 桥拦截分支同步异常加固（try/catch 吞噬+观测日志，验证：spec-sync B1 单测——mock client 缺 notifyTurnPhase 时 create 链走通）
- [x] task-03: daemon 测试夹具修复——task-lifecycle 两处过滤断言排除 turn_phase_report；spec-sync mock 工厂 importOriginal 兜底+client mock 补 notifyTurnPhase（验证：三文件 66 用例本地全绿）
- [x] task-04: frontend 5 个 CI 失败文件根因定位与修复——sessions-portal 为生产缺陷（草稿写抑制门闩 rAF 放行在高负载下迟到→首次输入持久化被静默跳过），源码修复（page+dialog 双模式改 effect 顺序放行）；对拍复现（portal+scroll 双文件）3 轮全绿、5 文件组合 4 轮全绿；其余 4 文件 CI 独有失败随批推送以 CI 实跑判定（验证：本地复刻组合连跑全绿+零删断言）
- [x] task-05: backend-ci 失败判定与修复——非挂死非撞顶：Pytest 实跑 40:55 后 1 例真实断言失败（test_http_heartbeat_accepts_and_clears_sillyspec_status 期望键集缺 thin_flows，c326a4b2b DTO 增字段漏更）——测试对账更新（run 40341250526 终态 failure 留痕）
- [x] task-06: 全量回归——daemon vitest 全量 299 文件（5129 passed，仅 8 失败且经 stash 对照实证为 Windows 本地固有、CI ubuntu 不触发）+ frontend 触及面（5 文件组合×4 轮 103 用例全绿、dialog/draft-scope 6 文件 106 用例全绿、typecheck 净、eslint 0 error 且存量告警少 1 条）；frontend 全量套件在本会话末段因并行会话 merge 冲突标记在途（turn-segment-views 等 5 文件）collect 级失败 92 文件——非本变更面（该批文件 import 链不触及本改动验证组合），待其收尾后 CI 实跑兜底（验证：触及面零新增失败）
- [x] task-07: backend heartbeat 测试键集对账 thin_flows（验证：uv run pytest test_machine_sillyspec.py 39 passed）
- [x] task-08: daemon 第二轮 CI 实测收尾——status-root mock 补 clearStatusProbeEviction（5 用例）+ kind-dispatch 技能库 fixture 注入 SILLYHUB_DAEMON_DIR（2 用例）（验证：两文件本地 33/33 绿；provider-session-dir ×1 为 Windows 偶发单跑绿不阻塞）
- [x] task-09: e2e-ci runner 钉 ubuntu-24.04——ubuntu-latest 已滚 26.04，Playwright 1.60 --with-deps 无 26.04 依赖包（验证：yml diff 仅 runs-on 行+注释）
- [x] task-10: frontend CI 满载兜底——vitest config CI 条件 retry:2（backend --reruns 同款先例），sessions-portal 经门闩修复 CI 实测转绿（426 文件仅剩 4 个 CI 独有失败）（验证：本地 retry=0 全绿不受影响；CI 实跑留痕）
- [x] task-11: 第三轮 CI 实测收尾——git-status expandDir 补「子行渲染完成」等待（fetch 已发≠DOM 已出，CI 竞态三连挂）；e2e proto-file-card 三层对齐现组件形态（数字断言改 header innerText containment；补 file-changes-other-toggle 点击步骤：agent 分组起 shell 归因收折叠区段，1+7/93+7 行数口径）——e2e-ci 被 pgvector 阻塞 10 天修复后连环暴露 spec 陈旧，逐轮 archaeology 收敛（验证：git-status 文件本地 8/8 绿；e2e 各轮 CI 实跑逐步收敛留痕）
