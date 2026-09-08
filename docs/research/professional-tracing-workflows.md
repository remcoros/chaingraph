# Professional tracing workflows and a bounded Bitcoin tracer

Research date: 2026-09-08. Discussion material, not an implementation decision.
The user explicitly prioritizes product goals over the current UI, architecture
and agent guidance. Existing modules below describe available building blocks,
not constraints on the proposed experience.
Public vendor descriptions establish advertised workflows, not independently
verified accuracy or access to their proprietary algorithms. No commercial
software was accessed and no third-party implementation code was copied.

## What established products expose

| Product | Publicly documented capabilities relevant here | Lesson for Chaingraph |
| --- | --- | --- |
| [Chainalysis Reactor](https://www.chainalysis.com/product/reactor/) | Fund-flow graphs, automated interpretation, annotations and off-chain context, real-world attribution | Start from an investigation and preserve a readable explanation of its paths. |
| [TRM Forensics](https://www.trmlabs.com/blockchain-intelligence-platform/forensics?scLang=en) | Address/entity navigation, multiple paths, source/confidence for attribution, custom graph elements | Let users move between a summarized route and its supporting transactions. |
| [TRM Signatures](https://www.trmlabs.com/resources/blog/detecting-the-invisible-the-power-of-trm-labs-signatures-tm-in-blockchain-investigations?scLang=en) | Recognition and quick plotting of peel-chain and branching patterns | Patterns should appear during tracing, with an action to inspect them. |
| [Elliptic Investigator](https://www.elliptic.co/products/investigator/) | Automatic graph construction, entity attribution and exportable investigation records | Build the useful graph automatically and keep evidence with the result. |
| [Elliptic behavioral detection](https://www.elliptic.co/insights/levelling-up-crypto-fraud-and-money-laundering-investigations-with-automatic-behavioral-detection/) | Pattern flags including peel chains, with acknowledged limits on inferring illicit activity | Describe observed structure neutrally. A repeated payment/change sequence does not establish intent. |

The common workflow is a starting lead, tracing and pattern recognition, review,
annotation, and an understandable case record. This is a design inference from
the public descriptions, not a claim about their complete internal interfaces.

## What their databases contribute

[Chainalysis describes](https://www.chainalysis.com/blog/chainalysis-data-accuracy/)
combining chain observations with separately collected attributions, human review,
and generic or service-specific clustering. Its public Bitcoin example is the
co-spend heuristic with collaborative-transaction handling. The same article's
deposit and event heuristics chiefly describe account-based chains, so those
must not be imported as Bitcoin rules.

An exact transaction relationship does not provide a service name. Chaingraph
can use imported wallet scripts, user annotations and explicitly sourced labels
as investigation context. Finding a familiar-looking consolidation alone must
not produce an exchange identity. Global entity search and comprehensive service
attribution would require a different data undertaking.

[Chainalysis's discussion of tracing mistakes](https://www.chainalysis.com/blog/common-blockchain-analysis-mistakes-cryptocurrency-investigations/)
also distinguishes ordinary peel-chain behavior from laundering and cautions
against treating exchange withdrawals as the continuation of a specific customer
deposit. On-chain custody movement remains inspectable, but a customer's balance
inside a service is not recoverable from that movement alone. A user-marked
custody boundary could therefore stop an identity-oriented trace while allowing
explicit exploration of subsequent chain transactions.

## Published methods and their limits

- [Bitcoin transaction guide](https://developer.bitcoin.org/devguide/transactions.html):
  inputs reference precise previous outputs. The chain does not record an
  allocation from each individual input to each output within a merge/split.
  Exact ancestry/spending edges and guessed continuation must be distinct.
- [Meiklejohn et al., A Fistful of Bitcoins](https://conferences.sigcomm.org/imc/2013/papers/imc182-meiklejohnA.pdf):
  co-spend and change clustering foundations, including the danger of false
  change links merging unrelated participants. Historical wallet behavior is
  not an unconditional rule for current transactions.
- [BlockSci change heuristics](https://citp.github.io/BlockSci/reference/heuristics/change.html):
  address reuse, type, amount and freshness signals, plus subsequent spending
  behavior. Signals can disagree. The documentation recommends refinement before
  clustering and supports returning no unique candidate. These are research
  references, not authorization to copy implementation code.
- [Kappos et al., How to Peel a Million](https://arxiv.org/html/2205.13882v1):
  forward/backward peel-chain analysis using transaction, address and cluster
  features. Its cluster-expansion methods depend on broader co-spend clustering
  and study-specific evaluation. Published performance must not become a
  confidence percentage for a bounded Chaingraph trace.
- [BIP78](https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki):
  PayJoin can defeat common-input ownership, matching-type change and round-amount
  assumptions. A transaction without conspicuous equal outputs is not thereby
  verified as single-owner.
- [ElectrumX protocol methods](https://electrumx.readthedocs.io/en/latest/protocol-methods.html):
  script histories and transaction retrieval can support local exact-outpoint
  spend discovery. A classic full-history response may be too large for a bounded
  request. Missing or refused history is not evidence of an unspent output.

## Feasibility within the existing architecture

Checked current `src/lib/tracing.ts`, `src/lib/api.ts`, `server/electrum.ts` and
`server/rpc-schema.ts`. Ancestry uses explicit previous transaction references.
Spending discovery fetches script histories and checks candidate inputs against
the exact outpoint. Existing operations already have concurrency and download
bounds, and reuse workspace observations.

A tracer can build on these without a new Chaingraph server index. Fulcrum remains
the existing history index. Forward lookup can cost much more than backward
lookup for heavily reused scripts. The current proxy negotiates protocol 1.4 and
permits only one-argument scripthash history requests. Newer protocol pages are
not evidence that deployed upstreams support newer outpoint or pagination APIs.
Capability discovery and implementation verification would precede such changes.

Proposed scanning behavior:

1. Start with a selected output, or resolve a selected input to its previous output.
2. Fetch missing chain evidence in bounded batches, separately from deciding which
   observations should appear on the canvas.
3. Rank candidate continuations with explicit reasons and counter-evidence.
   Imported wallet-script matches provide useful context; do not extend those
   matches automatically through every co-spend or change suggestion.
4. Preserve a frontier of unexplored branches. Deduplicate converging paths and
   make cancellation, budgets and missing evidence visible and resumable.
5. Stop automatic interpretation at unresolved ambiguity, conflicting signals,
   possible collaboration, an explicit endpoint or a resource limit. Continuing
   exact graph exploration should remain possible by user choice.

## Proposed first interaction

Select an input/output and choose **Trace**, then **Backward**, **Forward**, or
**Both**. Show compact progress and an expandable route/branch summary synchronized
with a transaction flow and broader graph context. Fetching supporting evidence
should not automatically fill the canvas with every fetched parent and sibling.

Each step should answer: what was observed, what continuation is suggested, why,
what alternatives remain, and why scanning stopped. Example statuses include
Verified spend, Likely change, Multiple candidates, and History incomplete.
These are different kinds of information, not points on one confidence scale.
Use explained confidence categories for hypotheses initially; calibrated numeric
probabilities require an evaluated model. Avoid multiplying correlated heuristic
scores into an apparently precise route confidence.

Useful existing analysis routines can become components of that workflow. The
tool-search/catalog panel need not remain the primary interface. No removal or
replacement is implemented by this research change.

The first interview decision is the tracing objective at a split: all plausible
value paths, probable wallet/change continuation, or the largest-value branch.
The proposed default is ranked, collapsible branches with explicit uncertainty,
pending the user's preference. A second decision is when ambiguity should pause
the scan versus merely pause automatic branch selection.

## Three alternative product directions

These are original proposals informed by the research, not copies of vendor UI.
The current sidebar, graph renderer and frontend/backend allocation are open to
replacement. The user's self-hosted, personal-wallet/hobbyist investigation goals
are the evaluation criteria.

### A. A focused tracing view

Place the selected output in the middle, earlier transactions to the left and
later transactions to the right. The primary surface is a readable 2D flow with
expandable transaction junctions. Collapse long repeated sequences into segments
such as a possible change chain, while preserving their individual transactions.
Mark unexamined alternatives and conflicting interpretations directly where they
occur. Selecting a junction opens its evidence and candidate continuations.

This is the recommended first experience for the chosen use-case. A broader 3D
view can supply context without occupying the main tracing surface. Its principal
risk is implying a unique path through a dominant horizontal line; alternate
branches and the reasons for selecting a continuation must remain discoverable.

### B. An open investigation canvas

Make an expandable 2D/3D canvas the primary workspace. Pin several subjects and
start bounded scans from any of them. Show suggested routes as a distinct preview
that users can inspect, expand and retain. Collapse known groups and repeated
patterns into expandable graph elements. Use contextual commands at nodes and
junctions rather than a permanent catalog of algorithms.

This best supports comparing investigations, finding reconvergence and arranging
evidence. Its main risk is clutter and loss of the original question. It needs a
persistent subject, branch budget and clear distinction between loaded evidence,
displayed nodes and retained conclusions.

### C. An investigation notebook

Begin with a question about an output. Present a short result such as observed
spends, candidate sources, possible continuations and unresolved junctions.
Each result opens its supporting flow and chain evidence. Notes, rejected paths,
assumptions and subsequent refreshes stay with that investigation.

This is strongest for learning and returning to work later. Its main risk is
making a ranked answer look authoritative before the user has inspected the
evidence. It should support exploration directly and avoid an opaque chat answer.

### Recommended combination and architecture implications

Start with A, allow users to pin traces into B when comparing several leads, and
retain the notes and decision history of C. Treat this as a discussion proposal,
not authorization to build all three experiences.

An investigation model should own the subject, retrieved observations, frontier,
candidate interpretations, accepted/rejected decisions and provenance. Separate
that model from both rendering and heuristic execution. Fetching and inference
placement can be reconsidered independently, while preserving network isolation,
watch-only operation, encrypted investigation storage and bounded resource use.
The architecture should make better heuristics and alternative renderers
replaceable without changing the meaning of a saved investigation.
