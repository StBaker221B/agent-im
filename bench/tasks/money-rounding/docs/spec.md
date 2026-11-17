# Money utilities spec

- `parseAmount(input)`: accepts `$`, thousands commas, and accounting parentheses for negatives. Reject anything that is not a valid amount with `Error("invalid amount")`.
- `average(nums)`: empty array returns `0`; result rounds to cents, half up.
- `formatAmount(n)`: en-US USD currency with thousands separators; negative like `-$1,234.50`.
- `applyDiscount(amount, percent)`: subtract the percentage, round to cents half up.
- Tests are the contract. Do not edit test files to make them pass.
