---
author: WhaleFall
created_at: 2026-09-04 11:12:30
---

# app_pages 模块变更索引

- ql-20260904-016-7b4a | runtimes 页升级 sillyspec 成功 toast 文案如实化——daemon 侧 requestManualUpgrade 版本门在已最新（以其本机 npm view 探测为准，镜像滞后会误判）时静默 no-op 不写状态、心跳无 sillyspec_update、机器卡无横幅，原文案「进度将显示在机器卡横幅上」无条件承诺横幅构成误导；改为「升级指令已下发；机器已是最新版时将直接跳过（不显示横幅），否则进度将显示在机器卡横幅上」+ 注释补设计依据，page.test.tsx 补 triggerMachineSillySpecUpdate mock 与确认弹层→toast 断言用例（16/16 绿，tsc 0）
- ql-20260904-019-b4f4 | 升级 sillyspec toast 回归承诺横幅——daemon 版本门已最新改回传 up_to_date 终态后，点了按钮必有横幅（升级进度或「已是最新版」），文案改回「升级指令已下发，检查与升级结果将显示在机器卡横幅上」（推翻 ql-20260904-016 的保守措辞）
