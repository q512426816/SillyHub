---
id: task-03
title: 'cli-pointer-lifecycle-immunity'
title_zh: 'CLI 指针生命周期免疫（恢复忽略/写入拦截/声明降级/doctor 画像）+ 回归测试'
author: qinyi
created_at: 2026-08-23 21:40:00
priority: P0
depends_on: [task-02]
blocks: [task-04]
repo: sillyspec
base_commit: 2c35ab240cf1489b1cffde9a47eb34f4971c358c
head_commit: 2c35ab240cf1489b1cffde9a47eb34f4971c358c
repo_root: /Users/qinyi/Desktop/sillyspec
requirement_ids: [FR-4, FR-5]
decision_ids: [D-001, D-002]
allowed_paths:
  - src/run/command.js
  - src/run/shared.js
  - src/init.js
  - src/doctor-diagnostics.js
  - test/
goal: >
  已中毒项目（指针/接管声明已落盘）在 CLI 侧自动失效——回本地模式、恢复内置 sync，
  且不再被新入口（scan flag/init/connect）重新投毒。依赖 task-02 产出的
  isSelfReferentialSpecRoot/isPlatformMode helper（不重复实现判定）。
implementation:
  - 指针恢复（command.js:309-345）：读到 .sillyspec-platform.json 后若 isSelfReferentialSpecRoot(cwd, saved.specRoot) → 忽略指针（platformOpts 置空，本地模式）+ console.warn 一行说明；specBase 保持既有取值链（自指时等于本地 .sillyspec 同物理目录）
  - 指针写入单点收口（execute 期裁决改法）：在 src/run/shared.js writePlatformPointer 函数体开头加自指守卫——isSelfReferentialSpecRoot(cwd, platformOpts.specRoot) 为真时 warn 一行并 return false 不落盘；单点同时覆盖 command.js:363 与 init.js writeInitPlatformPointer 两调用方，验收与 FR-4 等价且更稳。**不改 init.js**——工具仓并行变更 2026-08-23-adopt-harness-practices 已暂存 init.js 在途改动（执行期实测），避免纠缠；allowed_paths 中 init.js 保留权限但实际不动
  - 接管声明（command.js:349-359 fail-closed 分支）：decl.specRoot 自指 → 视为陈旧声明，warn 后按本地模式继续（不 exit 1）；非自指声明维持 fail-closed；disconnect 三清语义不变
  - doctor-diagnostics.js 增 repo-native 断链画像：指针存在且自指（建议删除或升级 CLI）、声明存在但指针缺失且自指（陈旧声明可 disconnect 清理）、cwd/.sillyspec 存在但 local.yaml 无 platform 段且存在自指残留（凭据缺失上行静默失败风险，design 风险 5 缓解）
  - 回归测试：三门禁（恢复忽略不进平台模式/写入拦截不落盘/声明降级不 exit 1）+ worktree 漂移守卫不回归（detectWorktreeSpecDrift 判定顺序不变）+ --spec-dir 真外部目录平台模式保持（D-002@v1/FR-5）
acceptance:
  - 自指指针存在时 run 命令本地模式运行且内置 sync 生效（FR-4）
  - 显式自指 --spec-root flag 不重写指针（FR-4）
  - 陈旧自指声明不阻断本地模式 exit 0（FR-4）
  - doctor 三类画像可诊断（FR-4，含凭据缺失预警）
verify:
  - cd /Users/qinyi/Desktop/sillyspec && npm test 全绿
  - tmp 项目构造自指指针 fixture 冒烟：run 命令输出 warn 且本地模式、exit 0
constraints:
  - disconnect 三清（sync.js:358-383）不改（design Phase 2 消费点 4）
  - .sillyspec-platform-cleaned marker 保护语义不动（HUB-12）
---

# task-03 补充说明
跨仓任务：在 sillyspec 仓直做直提（不进主仓 worktree）；commit message 注明本变更名。
