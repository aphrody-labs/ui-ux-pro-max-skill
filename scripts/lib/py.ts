/** Small helpers that reproduce Python formatting where byte-identical output matters. */
import { today } from "./paths.ts";

export class FailError extends Error {}

export function fail(message: string): never {
  throw new FailError(message);
}

/** json.dumps(value, ensure_ascii=False[, sort_keys]) without indent: ", " and ": " separators. */
export function pyDumps(value: unknown, sortKeys = false): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => pyDumps(item, sortKeys)).join(", ")}]`;
  if (typeof value === "object") {
    let keys = Object.keys(value as object);
    if (sortKeys) keys = keys.sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}: ${pyDumps((value as Record<string, unknown>)[key], sortKeys)}`).join(", ")}}`;
  }
  if (typeof value === "number" && Number.isInteger(value) && !Object.is(value, -0)) return String(value);
  if (typeof value === "number") return Number.isFinite(value) ? pyFloat(value) : value > 0 ? "Infinity" : value < 0 ? "-Infinity" : "NaN";
  return JSON.stringify(value);
}

/** repr() of a Python float. */
function pyFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/** urllib.parse.quote_plus with the default safe set. */
export function quotePlus(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

/** Python's format(value, "g"). */
export function formatG(value: number): string {
  if (value === 0) return Object.is(value, -0) ? "-0" : "0";
  const exponent = Math.floor(Math.log10(Math.abs(Number(value.toPrecision(6)))));
  if (exponent < -4 || exponent >= 6) {
    const [mantissa, exp] = value.toExponential(5).split("e");
    const trimmed = mantissa!.replace(/\.?0+$/, "");
    const sign = exp!.startsWith("-") ? "-" : "+";
    return `${trimmed}e${sign}${exp!.replace(/^[+-]/, "").padStart(2, "0")}`;
  }
  return String(Number(value.toPrecision(6)));
}

/** Compare with str.casefold() keys (stable sort keeps Python's tie behaviour). */
export function casefoldCompare(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

export function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** date.fromisoformat + sanity window (after 1970, not in the future). */
export function checkedDate(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label}: date must be YYYY-MM-DD`);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match ? new Date(Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!)) : null;
  if (!match || !date || date.getUTCMonth() !== +match[2]! - 1 || date.getUTCDate() !== +match[3]!) {
    fail(`${label}: invalid date '${value}'`);
  }
  if (+match[1]! <= 1970 || value > today()) fail(`${label}: suspicious date '${value}'`);
  return value;
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

export function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function sameKeys(value: object, keys: Iterable<string>): boolean {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

/** ast.literal_eval of a double-quoted Python string literal. */
export function pyStringLiteral(raw: string): string {
  const body = raw.slice(1, -1);
  return body.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{1,3}|.)/gs, (_, esc: string) => {
    switch (esc[0]) {
      case "x":
      case "u":
      case "U":
        return String.fromCodePoint(Number.parseInt(esc.slice(1), 16));
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "a":
        return "\x07";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "v":
        return "\v";
      case "\n":
        return "";
      default:
        if (/^[0-7]+$/.test(esc)) return String.fromCharCode(Number.parseInt(esc, 8));
        if (esc === "\\" || esc === '"' || esc === "'") return esc;
        return `\\${esc}`;
    }
  });
}
