"use client";

import { useState } from "react";
import { Button } from "antd";

import { CopyButton } from "@/components/agent-log/tool-renderers";
import { ApiError } from "@/lib/api";
import type { ResetPasswordResponse, UserRead } from "@/lib/admin";

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

/**
 * 自定义密码前端预校验，规则与后端 backend/app/core/security.py
 * assert_password_strength 对齐（≥8 位 + 同时含字母和数字）。弱口令黑名单
 * 仅后端持有，命中时 422 报错经 extractResetPasswordError 透传给用户。
 */
export function validateResetPassword(password: string): string | null {
  if (password.length < 8) {
    return "密码至少 8 位";
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "密码必须同时包含字母和数字";
  }
  return null;
}

/**
 * 从重置密码失败中提取用户可读的具体原因。422 validation_error 的真实
 * 原因藏在 details.errors[0].msg（形如 "Value error, 密码必须同时包含
 * 字母和数字。"，backend/app/core/errors.py 组装），剥 pydantic 前缀后透传。
 */
export function extractResetPasswordError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "validation_error") {
      const errors = (err.details as { errors?: { msg?: unknown }[] } | null)
        ?.errors;
      const msg = errors?.[0]?.msg;
      if (typeof msg === "string" && msg.trim()) {
        return msg.replace(/^Value error,\s*/, "");
      }
    }
    return err.message;
  }
  return "重置失败";
}

/**
 * 管理员重置用户密码弹窗。默认路径（不填自定义密码）后端随机生成一次性
 * 口令经响应 plaintext_password 下发，重置成功后在弹窗内展示（仅一次），
 * 由管理员复制转发给用户；自定义密码则按明文提交、成功即关闭。
 */
export function AdminResetPasswordDialog({
  user,
  onClose,
  onReset,
}: {
  user: UserRead;
  onClose: () => void;
  onReset: (_custom?: string) => Promise<ResetPasswordResponse>;
}) {
  const [custom, setCustom] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);

  const validationMsg = useCustom ? validateResetPassword(custom) : null;
  const displayName = user.username || user.email || "（未命名）";

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const resp = await onReset(useCustom ? custom : undefined);
      if (useCustom) {
        onClose();
      } else {
        setOneTimePassword(resp.plaintext_password);
      }
    } catch (e) {
      setErr(extractResetPasswordError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-[440px] rounded-md border bg-background p-5 shadow-lg">
        <h3 className="text-sm font-semibold">重置 {displayName} 的密码</h3>
        <div className="mt-3 space-y-3">
          {oneTimePassword === null ? (
            <>
              <p className="text-xs text-muted-foreground">
                不填自定义密码时，系统将随机生成一次性密码，重置成功后在此展示。
              </p>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={useCustom}
                  onChange={(e) => setUseCustom(e.target.checked)}
                  aria-label="自定义密码"
                />
                <span>自定义密码（不勾选则随机生成）</span>
              </label>
              {useCustom && (
                <div>
                  <label className="text-[11px] text-muted-foreground">
                    新密码（至少 8 位，需同时包含字母和数字）
                  </label>
                  <input
                    type="password"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    aria-label="新密码"
                    className={`mt-0.5 ${inputCls}`}
                  />
                  {custom.length > 0 && validationMsg && (
                    <p className="mt-1 text-[10px] text-destructive">
                      {validationMsg}
                    </p>
                  )}
                </div>
              )}
              <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
                重置密码后会撤销该用户的所有会话，强制重新登录。
              </p>
              {err && <p className="text-[11px] text-destructive">{err}</p>}
              <div className="flex justify-end gap-2">
                <Button size="small" onClick={onClose}>
                  取消
                </Button>
                <Button
                  type="primary"
                  size="small"
                  disabled={busy || (useCustom && validationMsg !== null)}
                  onClick={() => void submit()}
                >
                  {busy ? "重置中…" : "确认重置"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                密码已重置。一次性密码如下，仅显示一次：
              </p>
              <div className="flex items-center gap-2">
                <code className="break-all rounded border bg-muted px-2 py-1 font-mono text-sm">
                  {oneTimePassword}
                </code>
                <CopyButton text={oneTimePassword} label="复制" />
              </div>
              <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
                请立即复制保存并转发给该用户；用户首次登录后可自行修改密码。
              </p>
              <div className="flex justify-end gap-2">
                <Button type="primary" size="small" onClick={onClose}>
                  我已保存，关闭
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
