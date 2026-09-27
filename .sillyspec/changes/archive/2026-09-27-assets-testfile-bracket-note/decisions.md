---
author: flow-machine-draft
created_at: 2026-09-27T10:16:54.244Z
---
# 决策记录（Decisions）— 2026-09-27-assets-testfile-bracket-note

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：真实文件名含「」字符会被误剥——测试绑定约定「」为用例名注解语法，且仓库实测无此类测试文件名，接受该权衡并在函数注释言明。放弃方案 a：改 sillyspec CLI 的 flow done 补全解析（tests[] 只存纯路径）——治本但属另一仓库存量数据救不回，已按规则 15 记 docs/sillyspec/ 活跃坑；放弃方案 b：只在 TestFileBody 局部剥——resolveTestFilePath 的 norm 与搜索入参两处口径会分裂，故统一在归一函数做。
