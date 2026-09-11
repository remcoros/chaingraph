# Bitcoin amount display reference

Reviewed 2026-09-11: [Bitcoin Design, Units and symbols](https://bitcoin.design/guide/designing-products/units-and-symbols/), including its 17 illustrations.

The guide presents digit spacing, consistent unit treatment, aligned numerals and
trailing zeros as readability tools. Its Satcomma discussion describes grouping
fractional BTC digits from the right. It presents alternatives, not a universal
formatting standard. BTC denotes 100 million satoshis; an eight-place decimal
amount must carry the BTC unit.

For this application the user selected automatic sats/BTC display with right-grouped
BTC fractions. The implementation uses sats below one BTC and exact BTC above,
without adding unit preferences. Narrow non-breaking spaces prevent group breaks.
The choice of threshold is application policy. The guide's locale controls, fiat
conversion, hidden balances and alternate symbol proposals are outside this change.
Only the design principles are applied; no guide images or implementation code are
redistributed. See the amount presentation decision in [architecture](../architecture.md#amount-presentation).
