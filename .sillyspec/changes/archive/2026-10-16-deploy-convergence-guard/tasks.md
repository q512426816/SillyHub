---
author: flow-machine-draft
created_at: 2026-10-16T07:47:35.533Z
---
# 任务注册表（Tasks）— 2026-10-16-deploy-convergence-guard

- [x] task-01: build-and-save.sh 打包前必须校验当前分支为 main（非 main 时告警并需 ALLOW_NON_MAIN_DEPLOY=1 显式放行），并打印将要打包的 commit hash 与分支供留痕
- [x] task-02: deploy-to-server skill 必须新增「部署并流校验」节：打包前基于 main 校验、部署后 health commit_sha 与打包一致核对（不一致=被覆盖，附识别与恢复路径）
- [x] task-03: skill 中过期的 PROD_API_URL 示例必须更新为当前生产值 https://crrcdt.ppdmq.top
