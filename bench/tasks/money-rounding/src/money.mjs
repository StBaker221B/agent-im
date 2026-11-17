// Amount body: optional thousands commas, optional decimals (never "." / ".5").
const AMOUNT_BODY = /^(?:\d+|[1-9]\d{0,2}(?:,\d{3})*)(?:\.\d+)?$/;

function invalidAmount() {
  return new Error("invalid amount");
}

export function parseAmount(input) {
  if (input === null || input === undefined) throw invalidAmount();
  let s = String(input).trim();
  if (s === "") throw invalidAmount();

  let negative = false;
  let sawDollar = false;
  const takeDollar = () => {
    if (!s.startsWith("$")) return;
    if (sawDollar) throw invalidAmount();
    sawDollar = true;
    s = s.slice(1).trim();
  };

  if (s.startsWith("(")) {
    if (!s.endsWith(")") || s.length < 3) throw invalidAmount();
    s = s.slice(1, -1).trim();
    negative = true;
    if (/^[()]/.test(s) || s.startsWith("-") || s.startsWith("+")) throw invalidAmount();
  } else if (s.endsWith(")")) {
    throw invalidAmount();
  }

  // "$" may appear before or after the sign ("$-5" / "-$5"), but only once.
  takeDollar();
  if (s.startsWith("-")) {
    if (negative) throw invalidAmount();
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  takeDollar();

  // Explicit regex validation: Number("")/Number(" ") are 0 and Number("Infinity")
  // is Infinity, so Number() alone cannot distinguish valid from invalid input.
  if (!AMOUNT_BODY.test(s)) throw invalidAmount();
  const value = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(value)) throw invalidAmount();
  return negative && value !== 0 ? -value : value; // never return -0
}

/**
 * Round a finite number to integer cents, half away from zero.
 * Works on the number's shortest decimal representation (String(n)) instead of
 * Math.round(n * 100), so 1.005 -> 101, 1.015 -> 102, 2.675 -> 268, -1.005 -> -101.
 * Returns 0 for (positive or negative) zero.
 */
function toCents(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError("invalid number");
  }
  if (value === 0) return 0;

  const negative = value < 0;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(Math.abs(value)));
  if (!match) throw new RangeError("invalid number");

  const frac = match[2] ?? "";
  const exponent = Number(match[3] ?? 0) - frac.length;
  const digits = (match[1] + frac).replace(/^0+/, "");
  if (digits === "") return 0;

  const shift = exponent + 2; // cents = digits * 10^shift
  let whole;
  let rest;
  if (shift >= 0) {
    whole = digits + "0".repeat(shift);
    rest = "";
  } else {
    const keep = digits.length + shift;
    if (keep > 0) {
      whole = digits.slice(0, keep);
      rest = digits.slice(keep);
    } else {
      whole = "0";
      rest = "0".repeat(-keep) + digits;
    }
  }

  let cents = BigInt(whole === "" ? "0" : whole);
  if (rest.length > 0 && rest[0] >= "5") cents += 1n;

  const result = Number(cents);
  if (!Number.isSafeInteger(result)) throw new RangeError("invalid number");
  return negative ? -result : result;
}

function roundCents(value) {
  return Math.round(value * 100) / 100;
}

export function average(nums) {
  if (!Array.isArray(nums)) throw new TypeError("average expects an array");
  if (nums.length === 0) return 0; // short-circuit before dividing: 0/0 would be NaN
  let sum = 0;
  for (const n of nums) {
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new TypeError("average expects finite numbers");
    }
    sum += n;
  }
  return roundCents(sum / nums.length);
}

export function formatAmount(n) {
  const cents = toCents(n); // -0 -> 0, so it formats as $0.00
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  // Regex grouping instead of toLocaleString: locale/ICU independent.
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${String(remainder).padStart(2, "0")}`;
}

export function applyDiscount(amount, percent) {
  const discounted = amount - amount * (percent / 100);
  return roundCents(discounted);
}
