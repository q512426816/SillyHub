"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  fetchSliderCaptcha,
  verifySliderCaptcha,
  type SliderCaptchaData,
} from "@/lib/auth";

const BG_W = 300;
const BG_H = 150;
const GAP = 44; // 滑块块边长,须与后端 captcha_service._GAP 一致

interface SliderCaptchaProps {
  onVerified: (token: string) => void;
}

/**
 * 拖拉式滑块验证码。后端返回背景图(含凹槽)+ 滑块块,用户水平拖动滑块对齐凹槽,
 * 松手提交 x 坐标后端校验。凹槽在后端固定垂直居中,滑块块用 CSS calc(50% - 22px)
 * 自动对齐同一行,故只需水平拖动。
 */
export function SliderCaptcha({ onVerified }: SliderCaptchaProps) {
  const [data, setData] = useState<SliderCaptchaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [offsetX, setOffsetX] = useState(0);
  const [hint, setHint] = useState("向右拖动滑块完成验证");
  const [status, setStatus] = useState<"idle" | "verifying" | "ok" | "fail">(
    "idle",
  );
  const dragging = useRef(false);
  const startX = useRef(0);
  const startOffset = useRef(0);
  const latestOffset = useRef(0); // pointerup 读最新值,避免 listener 随 offsetX 重建
  const captchaIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus("idle");
    setOffsetX(0);
    latestOffset.current = 0;
    setHint("向右拖动滑块完成验证");
    try {
      const next = await fetchSliderCaptcha();
      captchaIdRef.current = next.captcha_id;
      setData(next);
    } catch {
      setHint("验证码加载失败,点击此处重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (status === "ok" || status === "verifying" || loading) return;
    dragging.current = true;
    startX.current = e.clientX;
    startOffset.current = latestOffset.current;
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const next = Math.max(
        0,
        Math.min(BG_W - GAP, startOffset.current + (e.clientX - startX.current)),
      );
      latestOffset.current = next;
      setOffsetX(next);
    };
    const up = async () => {
      if (!dragging.current) return;
      dragging.current = false;
      const id = captchaIdRef.current;
      if (!id) return;
      setStatus("verifying");
      setHint("验证中…");
      try {
        const res = await verifySliderCaptcha(id, latestOffset.current);
        if (res.success && res.captcha_token) {
          setStatus("ok");
          setHint("验证通过,正在登录…");
          onVerified(res.captcha_token);
        } else {
          setStatus("fail");
          setHint("验证失败,请重试");
          window.setTimeout(() => void refresh(), 600);
        }
      } catch {
        setStatus("fail");
        setHint("验证失败,请重试");
        window.setTimeout(() => void refresh(), 600);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [onVerified, refresh]);

  return (
    <div className="w-full select-none">
      <div
        className="relative mx-auto overflow-hidden rounded border border-slate-200 bg-slate-100"
        style={{ width: BG_W, height: BG_H }}
      >
        {loading || !data ? (
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex h-full w-full items-center justify-center text-xs text-slate-400"
          >
            加载中…
          </button>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.bg_image}
              alt=""
              width={BG_W}
              height={BG_H}
              draggable={false}
              className="block"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.slider_image}
              alt=""
              width={GAP}
              height={GAP}
              draggable={false}
              onPointerDown={onPointerDown}
              className="absolute touch-none"
              style={{
                top: "calc(50% - 22px)",
                left: offsetX,
                cursor: status === "ok" ? "default" : "grab",
              }}
            />
          </>
        )}
      </div>
      <div className="mt-1 text-center text-xs text-slate-500">{hint}</div>
    </div>
  );
}
