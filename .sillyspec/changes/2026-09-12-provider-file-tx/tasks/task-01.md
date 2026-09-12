---
id: task-01
title: 'atomic-write util: writeFileAtomic (tmp+fsync+rename, cleanup on failure)'
title_zh: '原子写基座——writeFileAtomic（tmp+fsync+rename+失败清 tmp）+ 单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 11:21:23
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/atomic-write.ts
  - sillyhub-daemon/tests/atomic-write.test.ts
target_files:
  - NEW:sillyhub-daemon/src/atomic-write.ts
  - NEW:sillyhub-daemon/tests/atomic-write.test.ts
goal: >
  为 per-session 配置写盘提供原子写原语：观察者任一时刻只见旧全文或新全文，
  失败不留半截文件与 tmp 残骸（FR-03 / D-003@v1）。
implementation:
  - 新增 sillyhub-daemon/src/atomic-write.ts：writeFileAtomic(path, data, encoding='utf-8')——open(tmpPath,'w') 写入 + filehandle.sync()（fsync）后 close，再 rename(tmpPath, path)；tmpPath = path + '.tmp-' + process.pid + '-' + 随机段；catch 分支 best-effort unlink(tmpPath) 后 rethrow 原错误
  - 新增 tests/atomic-write.test.ts：正常写+顶替已存在目标（读回新内容且目录无 .tmp-*）；rename 前注入失败（mock rename reject）→ 目标保持旧全文 + tmp 清理 + 抛错；win32 顶替语义锁定（本机 Windows 实跑即锁定 MoveFileEx 行为）；连续两次写不同内容（终值为其一且全文完整）
acceptance:
  - 四条单测全绿；失败注入用例断言目标旧全文逐字节保留、无 .tmp-* 残留
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/atomic-write.test.ts && pnpm typecheck
constraints:
  - 纯新增文件，不改任何既有源码/测试
  - 不引入 fsync 开关/配置（R-05）
  - rollout 拷贝等数据搬运不适用本原语（design 划界）
provides:
  - symbol: writeFileAtomic(path, data, encoding?) -> Promise<void>
    file: sillyhub-daemon/src/atomic-write.ts
    contract: 原子写——tmp+fsync+rename 顶替（Windows=MoveFileEx REPLACE_EXISTING）；失败 best-effort 清 tmp 后 rethrow
---


