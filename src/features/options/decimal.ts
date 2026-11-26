export function scaledDecimal(value: bigint, places: number) {
  if (places === 0) return value.toString();

  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value)
    .toString()
    .padStart(places + 1, '0');
  const whole = digits.slice(0, -places);
  const fraction = digits.slice(-places).replace(/0+$/, '');
  return fraction ? `${sign}${whole}.${fraction}` : sign + whole;
}

export function decimalKeys(values: readonly string[]) {
  const parts = values.map((value) => value.split('.'));
  const places = parts.reduce(
    (max, [, fraction = '']) => Math.max(max, fraction.length),
    0,
  );
  return parts.map(([whole, fraction = '']) =>
    BigInt(whole + fraction.padEnd(places, '0')),
  );
}

export function readPremiumFilter(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { minimum: null, error: false };
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return { minimum: null, error: true };
  return { minimum: trimmed, error: false };
}
