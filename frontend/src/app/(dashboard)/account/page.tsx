"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { changePassword } from "@/lib/auth";

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

const MIN_NEW_LENGTH = 8;

export default function AccountPage() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [oldError, setOldError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const oldTouched = oldPassword.length > 0;
  const newTouched = newPassword.length > 0;
  const confirmTouched = confirmPassword.length > 0;

  const oldValid = oldPassword.trim().length > 0;
  const newValid = newPassword.length >= MIN_NEW_LENGTH;
  const confirmValid =
    confirmPassword.length > 0 && newPassword === confirmPassword;

  const formValid = oldValid && newValid && confirmValid;

  const handleSubmit = async () => {
    if (!formValid || saving) return;
    setSaving(true);
    setOldError(null);
    setGlobalError(null);
    setSuccess(null);
    try {
      await changePassword(oldPassword, newPassword);
      setSuccess("密码已修改，其他设备需重新登录");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      // 401 旧密码错误（后端错误码 HTTP_401_PASSWORD_INCORRECT）→ 标红旧密码字段。
      // apiFetch 抛 ApiError，message 含 code 后缀 PASSWORD_INCORRECT 或中文「旧密码」。
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "修改失败";
      const isOldWrong =
        /PASSWORD_INCORRECT/i.test(msg) || /旧密码错误/.test(msg);
      if (isOldWrong) {
        setOldError("旧密码错误");
      } else {
        setGlobalError(msg || "修改失败");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header>
        <h1 className="mt-0.5">个人中心</h1>
        <p className="text-xs text-muted-foreground">账户信息与安全设置</p>
      </header>

      <div className="max-w-lg rounded-md border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">修改密码</h3>

        <div className="mt-3 space-y-2.5">
          <div>
            <label className="text-[11px] text-muted-foreground">
              旧密码 *
            </label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              aria-label="旧密码"
              className={`mt-0.5 ${inputCls} ${
                (oldTouched && !oldValid) || oldError
                  ? "border-destructive"
                  : ""
              }`}
            />
            {oldError && (
              <p className="mt-1 text-[10px] text-destructive">{oldError}</p>
            )}
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground">
              新密码 *（至少 {MIN_NEW_LENGTH} 位）
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-label="新密码"
              className={`mt-0.5 ${inputCls} ${
                newTouched && !newValid ? "border-destructive" : ""
              }`}
            />
            {newTouched && !newValid && (
              <p className="mt-1 text-[10px] text-destructive">
                新密码至少 {MIN_NEW_LENGTH} 位
              </p>
            )}
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground">
              确认新密码 *
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-label="确认新密码"
              className={`mt-0.5 ${inputCls} ${
                confirmTouched && !confirmValid ? "border-destructive" : ""
              }`}
            />
            {confirmTouched && !confirmValid && (
              <p className="mt-1 text-[10px] text-destructive">
                两次输入的新密码不一致
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={!formValid || saving}
              onClick={() => void handleSubmit()}
            >
              {saving ? "保存中…" : "修改密码"}
            </Button>
            {globalError && (
              <span className="text-xs text-destructive">{globalError}</span>
            )}
            {success && (
              <span className="text-xs text-emerald-600">{success}</span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-lg rounded-md border border-blue-300 bg-blue-50 px-4 py-3">
        <p className="text-[11px] leading-relaxed text-blue-700">
          初始密码为系统默认密码
          <span className="mx-1 font-mono font-semibold">SillyHub@123</span>
          ，建议尽快修改为自己的密码。修改成功后，其他设备需重新登录。
        </p>
      </div>
    </div>
  );
}
