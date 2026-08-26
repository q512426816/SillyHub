"use client";

/**
 * FloatingMascot — 悬浮宠物本体（2026-08-26 用户需求②：去掉能量球，
 * 整个按钮就是一只宠物）。
 *
 * 形象：全身 chibi 宠物纯 SVG（约 2.5KB 零依赖）。浅色描边 + 柔和投影 +
 * 动态地面阴影——脱离球面衬底后在任意页面背景（明/暗）都可读。白身为主、
 * 深紫五官、粉腮，品牌紫耳饰。
 *   - 小狗：垂耳 + 吐舌 + 呆毛 + 摇尾；
 *   - 小猫：立耳粉内 + 胡须 + ω 嘴 + 卷尾摆动。
 *
 * 动画（<style> 命名空间 fm-，CSS 变量控速）：
 *   - 待机：整体上下浮动（fm-float）+ 尾巴慢摇 + 4.2s 周期眨眼 + 地面阴影
 *     随浮动缩放（fm-shadow，与浮动反相，营造"离地"立体感）；
 *   - 悬停（宿主 .group:hover）：尾巴提速 + 耳朵轻抖（fm-ear）；
 *   - 会话进行（active）：快乐弯月眼 + 高频摇尾 + 弹跳节奏加快。
 *
 * 选择持久化：localStorage[sillyhub:floating-pet]（"dog" | "cat"，缺省 dog），
 * 由宿主读写（getFloatingPet/setFloatingPet），组件本身受控渲染。
 */
import { useId } from "react";

export type FloatingPet = "dog" | "cat";

const PET_STORAGE_KEY = "sillyhub:floating-pet";

export function getFloatingPet(): FloatingPet {
  if (typeof window === "undefined") return "dog";
  return window.localStorage.getItem(PET_STORAGE_KEY) === "cat" ? "cat" : "dog";
}

export function setFloatingPet(pet: FloatingPet): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PET_STORAGE_KEY, pet);
}

/** 描边色（浅背景可读 + 暗背景下勾形）。 */
const STROKE = "#b9a8e8";

/** 小狗全身：大圆头 + 豆身 + 前爪 + 垂耳摇尾。 */
function DogBody({ active }: { active: boolean }) {
  return (
    <>
      {/* 尾巴（右侧，摇） */}
      <g className="fm-tail">
        <path
          d="M50 40 q10 2 10 -8 q0 -5 -4 -4.5 q-2.5 .5 -1.5 3.5 q.8 4.5 -5 3.5 z"
          fill="#fff"
          stroke={STROKE}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </g>
      {/* 身体（豆形 + 肚皮） */}
      <path
        d="M20 44 q0 -10 12 -10 q12 0 12 10 q0 8 -12 8 q-12 0 -12 -8 z"
        fill="#fff"
        stroke={STROKE}
        strokeWidth="1.6"
      />
      <ellipse cx="32" cy="47" rx="7" ry="5.5" fill="#f3eeff" />
      {/* 垂耳（成对，连头一起动） */}
      <path d="M16 20 q-8 2 -7 13 q.8 9 7 9 q5 0 4.5 -8 q-.4 -9 -4.5 -14 z" fill="#cabcf2" stroke={STROKE} strokeWidth="1.2" />
      <path d="M48 20 q8 2 7 13 q-.8 9 -7 9 q-5 0 -4.5 -8 q.4 -9 4.5 -14 z" fill="#cabcf2" stroke={STROKE} strokeWidth="1.2" />
      {/* 头 */}
      <circle cx="32" cy="24" r="16" fill="#fff" stroke={STROKE} strokeWidth="1.6" />
      {/* 呆毛 */}
      <path d="M30 8.5 q1 -5 5.5 -5 q-2.2 1.6 -1.6 4 q2 -2 4.6 -1.4 q-4.4 1 -4.2 4.6 z" fill="#fff" stroke={STROKE} strokeWidth="1" strokeLinejoin="round" />
      {/* 眼 */}
      {active ? (
        <g stroke="#3a2e52" strokeWidth="2.3" strokeLinecap="round" fill="none">
          <path d="M22 23 q3 -4 6 0" />
          <path d="M36 23 q3 -4 6 0" />
        </g>
      ) : (
        <g className="fm-eyes" fill="#3a2e52">
          <circle cx="25" cy="23" r="2.8" />
          <circle cx="39" cy="23" r="2.8" />
          <circle cx="26" cy="22" r="0.9" fill="#fff" />
          <circle cx="40" cy="22" r="0.9" fill="#fff" />
        </g>
      )}
      {/* 鼻嘴舌 */}
      <ellipse cx="32" cy="30" rx="3" ry="2.2" fill="#3a2e52" />
      <path d="M32 32.4 q0 2.8 -3.2 2.8 M32 32.4 q0 2.8 3.2 2.8" stroke="#3a2e52" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {active && <path d="M29.8 35 q2.2 3.6 4.4 0 q-.4 3.2 -2.2 3.2 q-1.8 0 -2.2 -3.2 z" fill="#ff9db4" />}
      {/* 腮红 */}
      <circle cx="19.5" cy="28.5" r="2.4" fill="#ffb3c7" opacity="0.8" />
      <circle cx="44.5" cy="28.5" r="2.4" fill="#ffb3c7" opacity="0.8" />
      {/* 前爪搭身前 */}
      <ellipse cx="26" cy="50.5" rx="3.6" ry="2.8" fill="#fff" stroke={STROKE} strokeWidth="1.2" />
      <ellipse cx="38" cy="50.5" rx="3.6" ry="2.8" fill="#fff" stroke={STROKE} strokeWidth="1.2" />
    </>
  );
}

/** 小猫全身：立耳 + 胡须 + ω 嘴 + 左侧卷尾。 */
function CatBody({ active }: { active: boolean }) {
  return (
    <>
      {/* 卷尾（左侧，摆） */}
      <g className="fm-tail">
        <path
          d="M14 40 q-11 1 -10 -9 q.6 -5.5 5 -5 q3.4 .5 2.2 4 q-1.6 5 5 3.5 z"
          fill="#fff"
          stroke={STROKE}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </g>
      {/* 身体 */}
      <path
        d="M20 45 q0 -10 12 -10 q12 0 12 10 q0 8 -12 8 q-12 0 -12 -8 z"
        fill="#fff"
        stroke={STROKE}
        strokeWidth="1.6"
      />
      <ellipse cx="32" cy="48" rx="6.5" ry="5" fill="#f3eeff" />
      {/* 立耳（hover 轻抖） */}
      <g className="fm-ear">
        <path d="M18.5 17 l-3 -12.5 l12 7 z" fill="#fff" stroke={STROKE} strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M19.3 14.2 l-1.5 -6.2 l6 3.6 z" fill="#ffb3c7" />
      </g>
      <g className="fm-ear">
        <path d="M45.5 17 l3 -12.5 l-12 7 z" fill="#fff" stroke={STROKE} strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M44.7 14.2 l1.5 -6.2 l-6 3.6 z" fill="#ffb3c7" />
      </g>
      {/* 头 */}
      <circle cx="32" cy="25" r="16" fill="#fff" stroke={STROKE} strokeWidth="1.6" />
      {/* 眼 */}
      {active ? (
        <g stroke="#3a2e52" strokeWidth="2.3" strokeLinecap="round" fill="none">
          <path d="M22 24 q3 -4 6 0" />
          <path d="M36 24 q3 -4 6 0" />
        </g>
      ) : (
        <g className="fm-eyes" fill="#3a2e52">
          <circle cx="25" cy="24" r="2.8" />
          <circle cx="39" cy="24" r="2.8" />
          <circle cx="26" cy="23" r="0.9" fill="#fff" />
          <circle cx="40" cy="23" r="0.9" fill="#fff" />
        </g>
      )}
      {/* 鼻 + ω 嘴 */}
      <path d="M29.8 31 l4.4 0 l-2.2 2.8 z" fill="#ff9db4" />
      <path d="M32 34 q0 2.6 -3 2.6 M32 34 q0 2.6 3 2.6" stroke="#3a2e52" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* 胡须 */}
      <g stroke="#cabcf2" strokeWidth="1.2" strokeLinecap="round">
        <path d="M15 28 l-8 -1.6 M15.5 31.5 l-7.6 1.2" />
        <path d="M49 28 l8 -1.6 M48.5 31.5 l7.6 1.2" />
      </g>
      {/* 腮红 */}
      <circle cx="19.5" cy="30" r="2.4" fill="#ffb3c7" opacity="0.8" />
      <circle cx="44.5" cy="30" r="2.4" fill="#ffb3c7" opacity="0.8" />
      {/* 前爪 */}
      <ellipse cx="26" cy="51.5" rx="3.6" ry="2.8" fill="#fff" stroke={STROKE} strokeWidth="1.2" />
      <ellipse cx="38" cy="51.5" rx="3.6" ry="2.8" fill="#fff" stroke={STROKE} strokeWidth="1.2" />
    </>
  );
}

/**
 * 宠物本体（无球）：容器带浮动 + 投影 + 地面阴影。CSS 变量：
 *   --fm-wag-dur 尾速（active 0.45s / 待机 1.15s）；
 *   --fm-float-dur 浮动周期（active 1.6s / 待机 3s，弹跳更欢快）。
 */
export function FloatingMascot({
  pet,
  active = false,
  size = 46,
}: {
  pet: FloatingPet;
  active?: boolean;
  size?: number;
}) {
  const styleId = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <span
      aria-hidden
      data-testid="floating-mascot"
      data-pet={pet}
      data-active={active ? "true" : "false"}
      className={`fm-${styleId} relative block ${active ? "fm-active" : ""}`}
      style={
        {
          width: size,
          height: size,
          "--fm-wag-dur": active ? "0.45s" : "1.15s",
          "--fm-float-dur": active ? "1.6s" : "3s",
        } as React.CSSProperties
      }
    >
      <style>{`
.fm-${styleId} .fm-pet{animation:fm-float-${styleId} var(--fm-float-dur,3s) ease-in-out infinite;}
.fm-${styleId} .fm-eyes{animation:fm-blink-${styleId} 4.2s infinite;transform-origin:32px 24px;}
.fm-${styleId} .fm-tail{animation:fm-wag-${styleId} var(--fm-wag-dur,1.15s) ease-in-out infinite;transform-origin:32px 42px;}
.fm-${styleId} .fm-ear{animation:fm-ear-${styleId} 2.6s ease-in-out infinite;transform-origin:32px 20px;}
.fm-${styleId} .fm-shadow{animation:fm-shadow-${styleId} var(--fm-float-dur,3s) ease-in-out infinite;}
.group:hover .fm-${styleId} .fm-tail{animation-duration:0.4s;}
@keyframes fm-float-${styleId}{0%,100%{transform:translateY(0)}50%{transform:translateY(-3.5px)}}
@keyframes fm-shadow-${styleId}{0%,100%{transform:scale(1);opacity:.28}50%{transform:scale(.82);opacity:.16}}
@keyframes fm-blink-${styleId}{0%,91%,96%,100%{transform:scaleY(1)}93.5%{transform:scaleY(.12)}}
@keyframes fm-wag-${styleId}{0%,100%{transform:rotate(-9deg)}50%{transform:rotate(10deg)}}
@keyframes fm-ear-${styleId}{0%,82%,100%{transform:rotate(0)}87%{transform:rotate(-4deg)}92%{transform:rotate(3deg)}}
`}</style>
      {/* 地面阴影（与浮动反相——宠物跳起时阴影缩小变淡，立体感） */}
      <svg
        viewBox="0 0 64 64"
        className="fm-shadow absolute -bottom-0.5 left-1/2 h-full w-full -translate-x-1/2"
        role="presentation"
      >
        <ellipse cx="32" cy="59" rx="14" ry="2.6" fill="#1e1b4b" opacity="0.28" />
      </svg>
      <svg
        viewBox="0 0 64 64"
        className="fm-pet relative block h-full w-full drop-shadow-[0_5px_7px_rgba(30,27,75,0.35)]"
        role="presentation"
      >
        {pet === "cat" ? <CatBody active={active} /> : <DogBody active={active} />}
      </svg>
    </span>
  );
}
