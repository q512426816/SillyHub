---
author: flow-machine-draft
created_at: 2026-10-14T03:09:03.868Z
---
# 决策记录（Decisions）— 2026-10-14-logout-localstorage-user-data-cleanup

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：前缀注册表漏掉未来新增的用户域键（枚举式固有的漏网风险——与上变更放弃方案 A 同型）。缓解：键清单集中一处且有本测试钉住存量 6 前缀，新增键时注册表是唯一需要动的地方；已知取舍是接受「未来键需自觉登记」而非引入命名空间强约束（改造全部读写点收益/成本倒挂）。放弃方案 B：统一用户域键命名空间前缀（如 `sillyhub:user.*`）——需改 6 个文件的全部读写点+旧键迁移清理，收益只是「前缀扫描永不漏」，且改键会导致现有用户草稿/未读状态丢失，不值；放弃方案 C：在 logout-storage 里顺带清 session persist 键——session store 的 clear() 已负责（persist 落盘空值），双份清理引入「谁是真的清空者」歧义，不碰。
