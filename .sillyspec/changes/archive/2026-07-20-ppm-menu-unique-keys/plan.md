---
plan_level: full
author: qinyi
created_at: 2026-07-20 14:58:00
---

# 实现计划（Plan）— PPM 菜单权限 key 独立化

## Spike 前置验证

无。技术路径已在 brainstorm 调研确认（枚举扩容、seed 清单、seed_platform_admin_role 兜底幂等、menu-permissions 映射、测试同步），无不确定性。

## Wave 1（并行，无依赖）

- [ ] task-01: backend `permissions.py` 新增 9 个 PPM 菜单 key 枚举成员（枚举 PPM 8→17，总 53→62）（覆盖：FR-01, D-001）
- [ ] task-02: seed 迁移 `202607041000_seed_ppm_permissions` 的 `PPM_PERMISSIONS` 清单 8→17（覆盖：FR-03）
- [ ] task-03: frontend `menu-permissions.ts` 14 个 PPM 菜单 key 重映射为专属 key（覆盖：FR-02, D-001/D-002）

## Wave 2（依赖 Wave 1）

- [ ] task-04: 测试同步——`test_ppm_permissions.py` EXPECTED 8→17 + `test_permissions.py` count 53→62 + `menu-permissions.test.ts` mirror 54→63 及各菜单专属 key 断言（覆盖：FR-06）依赖：task-01, task-03
- [ ] task-05: `openapi.json` 重生成（ppm 枚举 17 值）+ 验证 platform_admin seed 兜底补 9 新 key（覆盖：FR-04, FR-07, R-04）依赖：task-01, task-02

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 枚举 +9 PPM key | W1 | P0 | — | FR-01, D-001 | group property 不变 |
| task-02 | seed 清单 8→17 | W1 | P0 | — | FR-03 | 新环境从头 seed 14 菜单 key |
| task-03 | 14 菜单 key 重映射 | W1 | P0 | — | FR-02, D-001/002 | 每菜单单元素数组专属 key |
| task-04 | 3 处测试同步 | W2 | P0 | task-01,03 | FR-06 | EXPECTED/count/mirror/菜单断言 |
| task-05 | openapi 重生成 + 补种验证 | W2 | P1 | task-01,02 | FR-04/07, R-04 | picker 数据源确认（悬空 key 显示与否） |

## 关键路径

task-01 → task-04（最长）。task-02/task-03 与 task-01 并行（W1）；task-05 与 task-04 并行（W2）。

## 全局验收标准

- **AC-1** 枚举 PPM_* 成员 17（14 菜单 key + 3 悬空），test_ppm_permissions 通过
- **AC-2** test_permissions count 断言 62 通过
- **AC-3** menu-permissions.ts 14 菜单各专属 key，无 2 菜单共享
- **AC-4** menu-permissions.test.ts mirror=63（PPM 17）全绿
- **AC-5** platform_admin seed 后拥有 17 个 PPM key（含 9 新增）
- **AC-6** backend lint（ruff+format+mypy）+ frontend typecheck 通过
- **AC-7** openapi.json ppm 权限枚举含 17 值
- **AC-8** picker 展示 14 个 PPM 菜单卡各 1 key；悬空 3 旧 key 显示与否按 picker 数据源确认

## 自检

- ✅ checkbox 格式：所有 task 用 `- [ ] task-XX:`
- ✅ FR 覆盖：FR-01~FR-08 全部映射到 task
- ✅ D 覆盖：D-001(task-01/03) / D-002(task-03) / D-003(task-05) / D-004(task-01) 全覆盖
- ✅ 依赖无环：W1 → W2 线性，Wave 内并行
- ✅ task 粒度均匀：5 task 范围清晰可独立验收
- ✅ 无 P0/P1 unresolved blocker（decisions 全 accepted）
