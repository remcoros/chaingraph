# Wallet review sources

Consulted 2026-09-09 for the local `experiment/wallet-review` slice. These are
primary references for terminology and boundaries. None of them authorises
copying an implementation, and none of them establishes counterparty identity.

## Sparrow Wallet FAQ

<https://sparrowwallet.com/docs/faq.html>

Applicability: confirms that a watch-only restoration depends on gap limits and
that a wallet cannot know about addresses beyond the scanned range. Used to keep
the coverage strip factual: discovered addresses, used addresses, partial
discovery and a continue action, with no completeness percentage.

Limits: the FAQ describes Sparrow's own defaults. Chaingraph keeps its existing
client-side gap and address bounds and does not adopt Sparrow's numbers.

## Sparrow: spending privately

<https://sparrowwallet.com/docs/spending-privately.html>

Applicability: supports the wording of the optional spend guidance sentence.
Combining inputs with different recorded sources in one ordinary transaction
publishes a link between them. Used only to phrase an evidence-based caution
about the outputs the user has explicitly selected.

Limits: this experiment builds no spend composer, coin selection, fee estimation,
PSBT, signing or broadcast. The guidance never claims a privacy score, a
probability, or that separate groups guarantee privacy.

## BIP329: label export format

<https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki>

Applicability: the label vocabulary of transaction, output (`txid:vout`) and
address references matches the identifiers this experiment edits in batches.
Chaingraph already implements a compatible label subset in `src/lib/labels.ts`.

Limits: BIP329 covers labels only. Review decisions and tags introduced here are
Chaingraph-specific encrypted workspace data and are deliberately not exported as
BIP329 records. Batch editing writes the same annotation objects the existing
exporter reads, so it does not change that format.

## BIP78: PayJoin

<https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki>

Applicability: the reason a co-spend is a hypothesis rather than proof. A PayJoin
transaction contains inputs from more than one party, so common-input reasoning
can be wrong. Used to keep grouping items explicitly labelled as hypotheses with
their evidence and an exclusion path.

Limits: Chaingraph does not detect PayJoin. The existing analysis registry only
excludes obvious equal-output candidates, which is a limited precaution and not a
CoinJoin or PayJoin detector.

## What this experiment deliberately did not use

No public entity or exchange dataset was consulted or bundled. A label such as
"Exchange A withdrawal" is a personal annotation on a specific receipt. It is not
an attribution of address ownership, and applying it to one output never claims
that the other outputs of that transaction belong to the same party.
