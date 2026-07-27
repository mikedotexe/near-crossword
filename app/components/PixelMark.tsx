export function PixelMark({
  compact = false,
  inverse = false,
}: {
  compact?: boolean;
  inverse?: boolean;
}) {
  return (
    <span
      className={`pixel-mark${compact ? " pixel-mark--compact" : ""}${
        inverse ? " pixel-mark--inverse" : ""
      }`}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
