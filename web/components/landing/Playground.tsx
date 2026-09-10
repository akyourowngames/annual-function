"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function Star({
  className = "",
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="m50 2 12.7 31.8L97 36.5 71 59l8 34-29-18-29 18 8-34L3 36.5l34.3-2.7L50 2Z" />
      <path
        d="m50 2 0 49L3 36.5 50 51 21 93 50 51 79 93 50 51 97 36.5 50 51Z"
        fill="#fff"
        opacity=".16"
      />
    </svg>
  );
}
export function usePlayground() {
  const canvas = useRef<HTMLCanvasElement>(null),
    frame = useRef(0),
    audio = useRef<AudioContext | null>(null);
  const [found, setFound] = useState<string[]>([]),
    [sound, setSound] = useState(false),
    [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      audio.current?.close();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  const burst = useCallback(
    (x: number, y: number) => {
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (sound) {
        try {
          audio.current ??= new AudioContext();
          const ctx = audio.current;
          void ctx.resume();
          [523.25, 659.25, 783.99].forEach((note, i) => {
            const o = ctx.createOscillator(),
              gain = ctx.createGain();
            o.type = "sine";
            o.frequency.value = note;
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(
              0.06,
              ctx.currentTime + 0.01 + i * 0.07,
            );
            gain.gain.exponentialRampToValueAtTime(
              0.001,
              ctx.currentTime + 0.6 + i * 0.07,
            );
            o.connect(gain);
            gain.connect(ctx.destination);
            o.start(ctx.currentTime + i * 0.07);
            o.stop(ctx.currentTime + 0.7 + i * 0.07);
          });
        } catch {
          /* Sound remains optional on devices without Web Audio. */
        }
      }
      if (reduced || !canvas.current) return;
      cancelAnimationFrame(frame.current);
      const el = canvas.current,
        ctx = el.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(devicePixelRatio, 2);
      el.width = innerWidth * dpr;
      el.height = innerHeight * dpr;
      ctx.scale(dpr, dpr);
      const colors = ["#f3e894", "#c4b4fa", "#a6d9bf", "#ed977e", "#faf5e9"];
      const particles = Array.from({ length: 70 }, (_, i) => ({
        x,
        y,
        vx: (Math.random() - 0.5) * 13,
        vy: Math.random() * -12 - 2,
        rotation: Math.random() * 6.28,
        size: Math.random() * 6 + 3,
        color: colors[i % colors.length],
        life: 1,
      }));
      let previous = performance.now(),
        elapsed = 0;
      const draw = (now: number) => {
        const dt = Math.min((now - previous) / 16.67, 2);
        previous = now;
        elapsed += dt;
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        for (const p of particles) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 0.2 * dt;
          p.rotation += 0.05 * dt;
          p.life = Math.max(0, 1 - elapsed / 110);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.globalAlpha = p.life;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }
        if (elapsed < 110) frame.current = requestAnimationFrame(draw);
        else ctx.clearRect(0, 0, innerWidth, innerHeight);
      };
      frame.current = requestAnimationFrame(draw);
    },
    [sound],
  );
  function discover(id: string, e: React.MouseEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    burst(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!found.includes(id)) {
      const next = [...found, id];
      setFound(next);
      setToast(
        next.length === 3
          ? "All three stars! The evening is a little brighter because of you."
          : id === "hero"
            ? "A little courage. A little wonder. You found your first star!"
            : "Another little spark of magic. Keep looking!",
      );
    } else setToast("Some things deserve an encore.");
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }
  return { canvas, found, sound, setSound, toast, discover, burst };
}

export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const rect = el.getBoundingClientRect();
    if (rect.top < innerHeight * 0.92) return;
    el.classList.add("reveal-ready");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          el.classList.add("revealed");
          observer.disconnect();
        }
      },
      { threshold: 0.08 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`play-reveal ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
