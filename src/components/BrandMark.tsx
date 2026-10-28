/**
 * The Synergy Swift mark: an "S" drawn as two swift wings meeting at a brass
 * centre, on an ink tile. Banded wings for normal sizes; `solid` for 16-20 px,
 * where the bands would blur. Full logo files (lockups, seal) are in public/brand.
 */
const BANDS = [
  "M256 256A64.7 64.7 0 0 1 330 150A65.3 65.3 0 1 0 256 256Z",
  "M256 256A64.7 64.7 0 0 1 182 362A65.3 65.3 0 1 0 256 256Z",
  "M256 256A66.7 66.7 0 1 1 330 150A72.2 72.2 0 1 0 256 256Z",
  "M256 256A66.7 66.7 0 1 1 182 362A72.2 72.2 0 1 0 256 256Z",
  "M256 256A74.7 74.7 0 1 1 330 150A84.8 84.8 0 1 0 256 256Z",
  "M256 256A74.7 74.7 0 1 1 182 362A84.8 84.8 0 1 0 256 256Z",
  "M256 256A86.9 86.9 0 1 1 330 150A100.9 100.9 0 1 0 256 256Z",
  "M256 256A86.9 86.9 0 1 1 182 362A100.9 100.9 0 1 0 256 256Z"
];
const SOLID = [
  "M256 256A65.9 65.9 0 0 1 330 150A100.9 100.9 0 1 0 256 256Z",
  "M256 256A65.9 65.9 0 0 1 182 362A100.9 100.9 0 1 0 256 256Z"
];

export function BrandMark({ className = "h-8 w-8", onDark = false, solid = false }: { className?: string; onDark?: boolean; solid?: boolean }) {
  const tile = onDark ? "#ffffff" : "#1b2d55";
  const wing = onDark ? "#1b2d55" : "#ffffff";
  return (
    <svg viewBox="0 0 512 512" className={`shrink-0 ${className}`} aria-hidden>
      <rect width="512" height="512" rx="112" fill={tile} />
      <g transform="translate(66.56 66.56) scale(0.74)" fill={wing}>
        {(solid ? SOLID : BANDS).map((d) => <path key={d} d={d} />)}
      </g>
      <circle cx="256" cy="256" r="15.5" fill={tile} />
      <circle cx="256" cy="256" r="9.6" fill="#b08d4f" />
    </svg>
  );
}
