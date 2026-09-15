const paths: Record<string, string> = {
  "arrow-down": "M12 4v16m-6-6 6 6 6-6",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z",
  music:
    "M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M9 9l12-2",
  star: "m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2 1.2-6.8-5-4.9 6.9-1L12 2z",
  volume: "m11 5-6 4H2v6h3l6 4V5z M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  "volume-off": "m11 5-6 4H2v6h3l6 4V5z M16 9l5 6m0-6-5 6",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  ticket: "M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4V5z M15 5v3m0 3v2m0 3v3",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  calendar:
    "M8 2v4m8-4v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2z M8 14h2m4 0h2m-8 3h2",
  chat: "M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z M8 10h8m-8 4h5",
  help: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 3h.01 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  chevron: "m9 5 7 7-7 7",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  clock: "M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  sparkle:
    "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z M20 2v4m-2-2h4",
  download: "M12 3v12m-5-5 5 5 5-5 M5 16v5h14v-5",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 4 4L19 6",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3z m-4 9 3 3 5-5",
  logout: "M9 3H4v18h5 M10 12h11m-4-4 4 4-4 4",
  close: "m6 6 12 12M6 18 18 6",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  scan: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 7h3v3H7zm7 0h3v3h-3zM7 14h3v3H7zm7 0h3v3h-3z",
  settings: "M4 7h16M4 17h16 M8 4v6m8 4v6",
  mail: "M3 5h18v14H3z m0 1 9 7 9-7",
  trash: "M3 6h18M9 6V3h6v3 M5 6l1 15h12l1-15M10 10v7m4-7v7",
  menu: "M4 6h16M4 12h16M4 18h16",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z M15 8a5 5 0 0 1 0 8",
  pulse: "M3 12h4l2-6 4 12 2-6h6",
};
export default function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={paths[name] ?? paths.sparkle} />
    </svg>
  );
}
