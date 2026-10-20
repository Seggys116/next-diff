type ClassValue = string | number | false | null | undefined | ClassValue[] | { [name: string]: unknown };

/** Joins class names, skipping anything falsy: `cn("a", cond && "b", { c: flag })`. */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  const add = (v: ClassValue) => {
    if (!v) return;
    if (typeof v === "string" || typeof v === "number") out.push(String(v));
    else if (Array.isArray(v)) v.forEach(add);
    else for (const [name, on] of Object.entries(v)) if (on) out.push(name);
  };
  values.forEach(add);
  return out.join(" ");
}
