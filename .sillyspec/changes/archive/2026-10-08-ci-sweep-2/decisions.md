---
author: flow-machine-draft
created_at: 2026-10-08T15:19:22.406Z
---
# 决策记录（Decisions）— 2026-10-08-ci-sweep-2

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：正则锚未来再随 schema 形态演化漂移——防哑绿抛错语义保留（失配即响亮失败），漂移会被即时暴露而非静默通过。放弃方案：回退四处生产变更让测试通过——放弃，均有变更档案/评审留痕的有意行为，回退等于推翻已验收功能；改用运行时 import 跨语言读词表——放弃，TS 无法 import Python 源，源文件读取式解析即先例形态。
