# Demonstration: patterns and hypotheses

Recorded and checked on 2026-09-08 against `72fc03e`, using a fresh browser
workspace and the local mainnet proxy. The annotated demonstration lasts 3:08
and includes workspace creation, the complete guided tour, labels, tags, an exact
spending link and comparison of common-input ownership parameters.

## Observed case

Transaction `323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2`
has five inputs and five outputs of 5,000,000 sats each. Output `:2` is consumed
at input index 1 of
`015d9cf0a12057d009395710611c65109f36b3eaefa3a694594bf243c097f404`.
The successor has nine inputs and four outputs: 791,116; 907,419; 9,136,520;
and 9,136,520 sats. These amounts and the exact outpoint link were checked with
read-only Core transaction data and bounded Electrum script history.

The default common-input heuristic skips the five-equal-output transaction.
It proposes a tentative input group for the successor, which the demonstration
explicitly excludes. Changing the equal-output skip threshold from three to two
then skips the successor too. Supporting parent transactions provide input
evidence without becoming targets in selected-transaction analysis.

This is one observed spending hop, not an exhaustive trace or a unique coin path.
Neither equal amounts nor a common-input group establish an owner. No final
destination or current unspent status is claimed.

## Sources and limits

- [Pinned am-i-exposed fixture](https://raw.githubusercontent.com/Copexit/am-i-exposed/3dd81a0dcf9fb4fedd6db6871e5e74315a50531f/src/lib/analysis/heuristics/__tests__/fixtures/api-responses/whirlpool-coinjoin.json):
  transaction discovery. Its publisher's Whirlpool name does not independently
  establish protocol provenance or ownership. No implementation code was copied.
- [BIP78](https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki):
  collaborative transactions can invalidate common-input ownership assumptions.
  It does not classify either transaction in this demonstration as PayJoin.
- [Samourai's Whirlpool guide](https://github.com/Samourai-Wallet/samourai-wallet-android/blob/develop/Guides/Whirlpool.md)
  and [mobile mixing instructions](https://samourai.kayako.com/article/91-mixing-on-mobile-with-whirlpool):
  background for an optional search for a TX0-change and post-mix co-spend.
- [MIT DCI research](https://www.dci.mit.edu/posts/coinjoin-timing-questions):
  background on mixing structure and inference limits.
- [Public forum candidate](https://bitcointalk.org/index.php?topic=5482818.msg63595307):
  discovery only. Transaction relationships were checked separately; the post's
  ownership claims were not adopted.

The bounded optional search found change consolidations and a post-mix
consolidation, but did not establish the requested specific TX0-change plus
post-mix co-spend. That claim is absent from the video. This search does not show
that such cases do not exist, and transaction structure cannot establish intent.

## Recording evidence

Local deliverables are under `artifacts/demo2/`: MP4, captions, exact timings,
public chain evidence, sources and the recorder's UI issue report. They are local
artifacts rather than application assets. The first demonstration remains intact.

The second recording has no internal cuts or speed changes. An independent check
confirmed H.264/yuv420p, 1600 by 1000 pixels, 25 fps, faststart and a complete
error-free decode. Full-size tour and analysis frames and the scene overview were
visually inspected. Capture reported no browser page errors.

The recording exposed two reproducible follow-up defects: analysis controls reset
across panel switches, and a fitted node label overlapped floating graph navigation.
Fix validation is recorded in [the validation report](../validation.md).
