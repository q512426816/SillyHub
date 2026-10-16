import { describe, expect, it } from "vitest";

import { changeFileSyncWarningText, type ChangeFileSyncResult } from "@/lib/change-file-sync";

function sr(partial: Partial<ChangeFileSyncResult>): ChangeFileSyncResult {
  return { triggered: true, ok: true, reason: null, stderr_tail: null, ...partial };
}

describe("changeFileSyncWarningText（2026-10-16-change-files-sync-result）", () => {
  it("回执 null（纯读/旧后端）不产出提示", () => {
    expect(changeFileSyncWarningText(null)).toBeNull();
  });

  it("执行成功（ok=true）不产出提示", () => {
    expect(changeFileSyncWarningText(sr({ ok: true }))).toBeNull();
  });

  it("防抖跳过（已触发且 ok=null）不产出提示——刚同步过/正在同步，非失败", () => {
    expect(
      changeFileSyncWarningText(sr({ ok: null, reason: "skipped_debounced" })),
    ).toBeNull();
    expect(changeFileSyncWarningText(sr({ ok: null, reason: "skipped_in_flight" }))).toBeNull();
  });

  it("未绑定（triggered=false）：提示「同步未执行」并带中文原因", () => {
    const text = changeFileSyncWarningText(
      sr({ triggered: false, ok: null, reason: "no_binding" }),
    );
    expect(text).toContain("同步未执行");
    expect(text).toContain("未绑定");
    expect(text).toContain("平台镜像数据");
  });

  it("daemon 离线（triggered=false）：提示「同步未执行」并带中文原因", () => {
    const text = changeFileSyncWarningText(
      sr({ triggered: false, ok: null, reason: "daemon_offline" }),
    );
    expect(text).toContain("同步未执行");
    expect(text).toContain("离线");
  });

  it("CLI 失败（ok=false）：提示「同步未完成」，中文原因 + stderr 尾段齐带上", () => {
    const text = changeFileSyncWarningText(
      sr({ ok: false, reason: "cli_failed", stderr_tail: "exit 1 HTTP 500（服务器内部错误）" }),
    );
    expect(text).toContain("同步未完成");
    expect(text).toContain("CLI");
    expect(text).toContain("HTTP 500");
    expect(text).toContain("可稍后重试");
  });

  it("RPC 超时（ok=false）：映射中文「超时」", () => {
    const text = changeFileSyncWarningText(sr({ ok: false, reason: "rpc_timeout" }));
    expect(text).toContain("同步未完成");
    expect(text).toContain("超时");
  });

  it("daemon 未认领工作区 / 拒绝执行 / 连接中断：各映射独立中文原因", () => {
    expect(changeFileSyncWarningText(sr({ ok: false, reason: "no_workspace_root" }))).toContain(
      "尚未认领",
    );
    expect(changeFileSyncWarningText(sr({ ok: false, reason: "rpc_remote_error" }))).toContain(
      "拒绝执行",
    );
    expect(changeFileSyncWarningText(sr({ ok: false, reason: "runtime_offline" }))).toContain(
      "连接中断",
    );
  });

  it("未知 reason 原样透出（宁多勿吞），不产出「未知原因」占位", () => {
    const text = changeFileSyncWarningText(sr({ ok: false, reason: "weird_new_reason" }));
    expect(text).toContain("weird_new_reason");
    expect(text).not.toContain("未知原因");
  });

  it("reason 缺失（异常兜底）回落「未知原因」，仍产出提示", () => {
    const text = changeFileSyncWarningText(sr({ ok: false, reason: null }));
    expect(text).toContain("同步未完成");
    expect(text).toContain("未知原因");
  });
});
