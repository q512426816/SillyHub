/**
 * change 2026-07-25-daemon-borrow-for-business task-13 / FR-04 / D-002@v1
 *
 * 业务人员触发 agent = 复用现有触发 UI（前端无感，D-002）。
 *
 * 本测试锁定契约：
 *  1. 触发入口仍是现有的 ``scanGenerate``（``@/lib/workspaces``）—— 业务人员与开发
 *     人员走同一条触发路径，不引入"选 daemon"交互。
 *  2. 借用能力（task-12）只新增"共享开关 / 共享管理 / 撤销"三件套（在 workspace-binding.ts），
 *     不新增 borrow 触发函数 / 不新增 /borrow-run 端点客户端 —— 借用是 placement 后端
 *     自动回退（task-07/08），前端无感。
 *
 * 这是 D-002（自动借用、前端无感）的前端防回归锚点：如果将来有人误加 borrow 触发
 * 函数到 workspace-binding，本测试会 fail，提醒"触发复用现有、不新增"。
 */
import { describe, expect, it } from "vitest";

import * as workspacesLib from "@/lib/workspaces";
import * as bindingLib from "@/lib/workspace-binding";

describe("task-13 / FR-04 业务触发复用现有 UI（D-002 前端无感）", () => {
  it("触发入口仍是现有 scanGenerate（@/lib/workspaces）", () => {
    // 业务人员与开发人员共用同一触发函数，借用是后端 placement 回退
    expect(typeof workspacesLib.scanGenerate).toBe("function");
  });

  it("workspace-binding 只新增共享管理三件套，不引入 borrow 触发函数", () => {
    // task-12 借用相关：共享开关 / 列共享 / 撤销共享（D-003 授权三件套）
    expect(typeof bindingLib.setMyBindingShared).toBe("function");
    expect(typeof bindingLib.fetchSharedDaemons).toBe("function");
    expect(typeof bindingLib.revokeSharedDaemon).toBe("function");

    // 防回归：不应出现 borrow 专用触发函数（触发复用现有 scanGenerate）
    expect((bindingLib as Record<string, unknown>).dispatchBorrowRun).toBeUndefined();
    expect((bindingLib as Record<string, unknown>).triggerBorrowAgent).toBeUndefined();
    expect((bindingLib as Record<string, unknown>).borrowTrigger).toBeUndefined();
  });
});
