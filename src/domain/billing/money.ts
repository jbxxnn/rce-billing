const MAX_MINOR = 9223372036854775807n;
export function parseUsd(value: string): bigint {
  if (!/^(0|[1-9]\d{0,16})(\.\d{1,2})?$/.test(value))
    throw new Error(
      "Enter a non-negative USD amount with at most two decimal places",
    );
  const [whole, fraction = ""] = value.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor > MAX_MINOR) throw new Error("Amount exceeds supported range");
  return minor;
}
export function formatUsd(minor: bigint | string): string {
  const value = BigInt(minor);
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
}
