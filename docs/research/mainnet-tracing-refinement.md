# Mainnet tracing and amount filtering

Observed 2026-09-08 through the configured local mainnet Core/Electrum bridge.
No credential files were opened. These are transaction observations, not owner,
change-output or dust-attack attributions.

## Reproduction

Transaction `1d690f3b96b878067f3a445b74dfb8fab4201c0455d88ac98cc14a927e7858d7`
was observed in block 966,087. Starting empty with Previous Off loaded the selected
transaction plus its direct input context: 6 graph nodes and 5 connections. On
baseline `8cd1c27`, the hover-card Load previous action expanded that cached parent
to 18 nodes and 17 connections without another RPC request, but said “0 previous
transactions added.” Removing the root left 14 nodes belonging to the expanded
parent. Independent browser testing reproduced both behaviors.

The corrected notice distinguishes expanding cached context from downloading new
transactions. Ancestry provenance survives render expansion so unused context can
be removed with its root. Shared or annotated observations remain protected.

## Observed amounts

The selected transaction spends parent
`7c0fb4ffff35bf9894211d3c97abbb58fc127573a1805880103dd19e40528523:2`,
worth 59,849,989,807 sats. Its outputs are:

| Output | Satoshis | Observation |
| --- | ---: | --- |
| 0 | 0 | OP_RETURN text: `All messages will be in plaintext.` |
| 1 | 1,000 | P2WSH |
| 2 | 59,849,988,609 | P2WPKH |

The difference between input and outputs is a 198 sat fee.

The parent spends ten outputs. The largest is
`af97cc9495b04314afa1a0d0d633db8200a6772832be1c84a6f345e58959bfc1:2`,
worth 59,849,987,177 sats. The other nine contain 300, 300, 300, 320, 546,
1,000, 1,000, 1,000 and 1,000 sats, totaling 5,766 sats. A 10,000 sat display
threshold isolates the large input in the parent flow. This value distribution
alone does not establish why the smaller outputs were received or consolidated.

## Primary-source reference

[Bitcoin Core policy.cpp, GetDustThreshold](https://github.com/bitcoin/bitcoin/blob/master/src/policy/policy.cpp),
consulted 2026-09-08, calculates dust using output script/spend size and a relay fee
rate. Therefore the UI uses explicit satoshi amounts and calls this a display
filter. It does not present one fixed threshold as universal Bitcoin dust policy.
No upstream code was copied.

The original transaction can be independently inspected at
[mempool.space](https://mempool.space/tx/1d690f3b96b878067f3a445b74dfb8fab4201c0455d88ac98cc14a927e7858d7).
The amounts above were verified against the configured node, rather than inferred
from explorer labels. Confirmation/spending state can change after the observation.
