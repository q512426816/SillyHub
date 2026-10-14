# 符号影响面报告

> tasks.md 内容指纹（生成时）: 6c2c81003d99dc34——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: Permission 枚举新增成员 DEPLOY_RECORD_READ（枚举追加，非签名变更）；受影响调用点：backend/tests/modules/auth/test_permissions.py:50 的 len(Permission)==58 硬计数锚（必破，在任务范围内同步改 59）；seed_platform_admin_role 启动期绑全部枚举自动覆盖新成员（无需改）。无其他签名级变更。
- task-02: 全新模块 backend/app/modules/deploy_records/**（service/schema/router/tests 均新建）——零既有符号改动；main.py 仅追加 import + include_router 两行（对齐 scan_docs 先例，不动既有注册）。consumes：workspace/service.py:58 的 _rewrite_path（import 使用不改签名）。无签名级变更。
- task-03: 纯生成物更新（backend/openapi.json + frontend/src/lib/api-types.ts 由 gen:types 机器生成）；无手写符号变更。api-types.ts 是声明文件追加，消费方为 task-04 新代码，既有前端代码零影响。无签名级变更。
- task-04: 新建 frontend/src/lib/deploy-records.ts（fetch 函数 + hooks）与 /deploy-records 页面；query-keys.ts 追加 deployRecords 工厂键（追加不改既有键，零既有消费方）。无签名级变更。
- task-05: MENU_PERMISSION_GROUPS 数组追加 deploy-records 条目（数组追加非签名变更）；受影响调用点：frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx 声明序断言锚（必破，任务范围内重算）+ frontend/src/lib/__tests__/menu-permissions.test.ts、permission.test.ts、admin-role-permission-picker-tree.test.tsx、top-bar.test.tsx 四处若断言菜单数/序同步修（均在 allowed_paths 或排查清单）。app-shell.tsx 的 MENU_ICON_MAP 追加一键（Record 追加）。无签名级变更。
- task-06: 纯文档改动（.zcode/skills/sillyhub-docker-deploy/SKILL.md 追加章节）。无签名级变更。
