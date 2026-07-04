import type { Discipline } from "@/lib/types";

type IconProps = { className?: string; size?: number; style?: React.CSSProperties };

const base = (size: number, style?: React.CSSProperties) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", style,
  stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
});

export function SwimIcon({ className, size = 20, style }: IconProps) {
  return (
    <svg {...base(size, style)} className={className}>
      <circle cx="17" cy="7" r="1.6" />
      <path d="M5 13c1.2-1 2.3-1 3.5 0s2.3 1 3.5 0 2.3-1 3.5 0 2.3 1 3.5 0" />
      <path d="M5 17c1.2-1 2.3-1 3.5 0s2.3 1 3.5 0 2.3-1 3.5 0 2.3 1 3.5 0" />
      <path d="M7 12l4-2.5-3-2.2 4.5-1" />
    </svg>
  );
}
export function BikeIcon({ className, size = 20, style }: IconProps) {
  return (
    <svg {...base(size, style)} className={className}>
      <circle cx="6" cy="17" r="3.2" />
      <circle cx="18" cy="17" r="3.2" />
      <path d="M6 17l4-7h5l-3 7M10 10l-1-3H7M15 10l1.5 3" />
    </svg>
  );
}
export function RunIcon({ className, size = 20, style }: IconProps) {
  return (
    <svg {...base(size, style)} className={className}>
      <circle cx="15" cy="4.5" r="1.6" />
      <path d="M13.5 8.5l-3 2 2 2.5 1 5M12.5 10.5l3 1.5 2.5-1M10.5 15l-2.5 1-1.5 3" />
    </svg>
  );
}
export function StrengthIcon({ className, size = 20, style }: IconProps) {
  return (
    <svg {...base(size, style)} className={className}>
      <path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />
    </svg>
  );
}
export function RestIcon({ className, size = 20, style }: IconProps) {
  return (
    <svg {...base(size, style)} className={className}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.2 6.2 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

export function DisciplineIcon({ discipline, className, size, style }: { discipline: Discipline } & IconProps) {
  switch (discipline) {
    case "swim": return <SwimIcon className={className} size={size} style={style} />;
    case "bike": return <BikeIcon className={className} size={size} style={style} />;
    case "run": return <RunIcon className={className} size={size} style={style} />;
    case "strength": return <StrengthIcon className={className} size={size} style={style} />;
    default: return <RestIcon className={className} size={size} style={style} />;
  }
}

export function CheckIcon({ className, size = 16, style }: IconProps) {
  return <svg {...base(size, style)} className={className}><path d="M4 12.5l5 5 11-11" /></svg>;
}
export function DownloadIcon({ className, size = 16, style }: IconProps) {
  return <svg {...base(size, style)} className={className}><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" /></svg>;
}
export function CloseIcon({ className, size = 18, style }: IconProps) {
  return <svg {...base(size, style)} className={className}><path d="M6 6l12 12M18 6L6 18" /></svg>;
}
export function FlagIcon({ className, size = 16, style }: IconProps) {
  return <svg {...base(size, style)} className={className}><path d="M5 3v18M5 4h11l-2 3 2 3H5" /></svg>;
}
