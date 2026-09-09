# Wallet context and selection refinement

This pass follows manual feedback about review counts, wallet editing, unclear
selection scope and the selected-item action layout.

## Result

- Every Show option includes a count. A plus sign identifies partial counts when
  additional review candidates have not been loaded into the list.
- Add wallet is available beside the wallet switcher. The shared pencil dialog
  works in the Wallet workbench and Graph sidebar. It autosaves only the name;
  its read-only extended public key is masked on every opening.
- The selected item distinguishes a verified wallet output, earlier wallet
  receipt, possible counterparty or wallet-related transaction. Metadata, review
  decisions and exploration have named sections and contextual explanations.
- A compact, collapsible transaction flow shows actual inputs and outputs,
  verified wallet matches and the selected output. Large lists expand inside a
  bounded region; the selected output remains visible in a collapsed list.
  Inspect uses the existing Wallet handoff and Back returns to its invoker.
- Select all N results replaces the selection with the full current filtered
  list, including rows under Show more. Select related offers exact address and
  creating-transaction matches from that same list. Counts precede application;
  neither action establishes a common owner or adds other graph entities.

## Independent findings and corrections

A read-only browser review used fresh desktop 1440 × 900 and phone 390 × 844
contexts with public mocked wallet data. It found two substantive issues:

1. The first flow wording said Outside this wallet. That was too categorical for
   a partial wallet scan. It now says No wallet match and explicitly limits the
   statement to discovered addresses. Missing prevouts remain unknown.
2. Same address initially missed sources and counterparties supplied as raw
   scripts without address metadata. Queue addresses now decode authoritative
   scripts with the workspace network. Conflicting imported address text is
   ignored, and malformed/non-address scripts never fall back to such claims.
   Valid address-only observations are still supported. Review fingerprints and
   decisions remain unchanged.

The reviewer independently closed both findings. It confirmed the source's exact
same-address selection and the qualified flow wording on desktop and phone.
The desktop context and actions now sit beside each other; phone content remains
stacked and requires normal scrolling. No horizontal overflow or clipped controls
was observed. Local evidence is under `artifacts/wallet-context-review/`, with
additional browser screenshots in `artifacts/wallet-review/` and wallet editor
screenshots in `artifacts/wallet-name/`.

## Validation

- Twenty-four distinct Wallet browser journeys passed. The main 23-case run
  covered review, rename, encrypted reload, wallet scope, editor lifecycle,
  cached navigation/Undo, changed evidence, related selection and desktop/phone
  context. A focused follow-up added large-flow expansion and selected-output
  retention, alongside fresh contextual screenshots.
- Forty-four focused domain tests passed, covering review decisions, script and
  network validation, conflicting address claims, missing data, verified direct
  source links, exact related selection and batch metadata.
- Build/typecheck, scoped formatting, portability and diff checks passed.

These checks use synthetic public fixtures and intercepted RPC responses. They
are not live upstream scans, native-device certification or publication. No
credential files, private wallet data, backend storage or cryptographic formats
were changed.
