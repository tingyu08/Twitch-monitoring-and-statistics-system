export function getSingleStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue : undefined;
  }

  return undefined;
}

export function getStringWithDefault(value: unknown, fallback: string): string {
  return getSingleStringValue(value) ?? fallback;
}
