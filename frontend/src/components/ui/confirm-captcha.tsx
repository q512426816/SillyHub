"use client";

import { useCallback, useState } from "react";
import { ShieldCheck, Shield, Loader2 } from "lucide-react";

import { fetchConfirmCaptcha, verifyConfirmCaptcha } from "@/lib/auth";

interface ConfirmCaptchaProps {
  onVerified: (token: string) => void;
}
/**
 * 点按式人机确认(替代原拖拉滑块,体验差已下线)。
 *
 * 交互:点一下「我不是机器人」→ 取一次性 captcha_id → 立即校验换 captcha_token
 * → onVerified(token)。失败可重试。防爆破主力是后端 IP 限流 + 失败计数,本组件
 * 只是把"证明是真人"这一步从拖滑块简化为点按,安全语义不变(仍需后端往返取有效 token)。
 */
export function ConfirmCaptcha({ onVerified }: ConfirmCaptchaProps) {
  const [status, setStatus] = useState<
    "idle" | "verifying" | "ok" | "fail"
  >("idle");

  const handleClick = useCallback(async () => {
    if (status === "verifying" || status === "ok") return;
    setStatus("verifying");
    try {
      const { captcha_id } = await fetchConfirmCaptcha();
      const res = await verifyConfirmCaptcha(captcha_id);
      if (res.success && res.captcha_token) {
        setStatus("ok");
        onVerified(res.captcha_token);
      } else {
        setStatus("fail");
      }
    } catch {
      setStatus("fail");
    }
  }, [status, onVerified]);

  const box = (() => {
    if (status === "ok") {
      return (
        <span className="flex h-5 w-5 items-center justify-center rounded border border-emerald-500 bg-emerald-500 text-white">
          <ShieldCheck className="h-3.5 w-3.5" />
        </span>
      );
    }
    if (status === "verifying") {
      return (
        <span className="flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-card">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
        </span>
      );
    }
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-card transition-colors group-hover:border-brand-500">
        <Shield className="h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-brand-500" />
      </span>
    );
  })();

  const label =
    status === "ok"
      ? "已通过人机验证"
      : status === "verifying"
        ? "验证中…"
        : status === "fail"
          ? "验证失败,点击重试"
          : "我不是机器人";

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={status === "verifying" || status === "ok"}
      className={[
        "group flex w-full select-none items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
        status === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : status === "fail"
            ? "border-red-200 bg-red-50 text-red-600"
            : "border-slate-200 bg-slate-50 text-slate-700 hover:border-brand-300 hover:bg-brand-50/50",
      ].join(" ")}
    >
      {box}
      <span className="font-medium">{label}</span>
    </button>
  );
}
