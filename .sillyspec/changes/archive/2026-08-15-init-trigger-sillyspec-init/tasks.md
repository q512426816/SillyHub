---
author: qinyi
created_at: 2026-08-15T15:07:51
change: 2026-08-15-init-trigger-sillyspec-init
stage: brainstorm
status: draft
---

# Tasks — init lease 触发 sillyspec init

> brainstorm 产出的任务草案，plan 阶段将拆解为 Wave/Task 结构。

- task-01 CLI：`--no-skills` 开关（index.js 解析 + init.js doInstall 跳过 skills 复制段 + 测试）
- task-02 CLI：`--tool` 逗号/重复多值（index.js 解析 + cmdInit 展开校验 + 测试）
- task-03 CLI：平台模式跳过项目内 .sillyspec 清理段（init.js doInstall + 测试断言 local.yaml 保留）
- task-04 daemon：spec-sync.ts 新增 runSillyspecInit（版本门控 + spawn + 60s 超时杀树 + 退出码映射）+ 单测
- task-05 daemon：handleInitLease 插入 init 步骤（pull 后 post 前，硬失败 abort）+ HandleInitLeaseParams.tools + 单测（6 步顺序/失败 abort）
- task-06 daemon：tools 透传链（cli.ts 构造前 detectAgents 映射 + TaskRunner 构造注入 + _runInitLease 透传/兜底 claude）+ 单测
- task-07 daemon：projects/ 三处排除统一（computeIncrementalOps/buildFullManifest/packSpecDir）+ 单测（含全量缓存无 projects 行防 delete op）
- task-08 daemon：改写 test_init_lease.test.ts（runSillyspecInit 依赖注入 + 既有 mock 适配 + 新增成功/失败/门控用例）
- task-09 backend：apply_ops 冲突分支同 hash no-op（new_versions 回写）+ pytest（同 hash no-op/异 hash conflict/无 hash 不变）
- task-10 集成验证：本机真实 daemon init lease 走通（首成员产物断言 + 第二成员骨架 no-op 无 conflict）
