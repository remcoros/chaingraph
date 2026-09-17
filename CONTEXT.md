# Chaingraph

Chaingraph is a watch-only Bitcoin workbench. A Workspace preserves the chain
information and human work needed to continue an investigation.

## Language

**Workspace**:
An investigation document containing loaded chain data, wallets, annotations,
analysis, connection-scan results and saved presentation.
_Avoid_: Evidence container

**Chain data**:
Loaded Bitcoin transactions, outputs and scripts, together with observations of
their placement, history and status. Loaded information can be incomplete or old.

**Wallet**:
A watch-only definition with derived scripts and addresses, discovery coverage,
and associated activity. A wallet relationship does not identify a person or
prove that the user possesses private keys.

**Outpoint**:
A transaction output reference consisting of a transaction ID and output index.
Its identity is separate from whether it was observed spent or unspent.

**Script**:
The Bitcoin script specifying an output's spending conditions. Some scripts have
an address representation; others do not.

**Address**:
A network-qualified representation of a supported output script. Wallet
derivations connect wallet definitions to scripts and their addresses.

**Observation**:
A source's report about a chain subject, with its acquisition context, time and
coverage when known. Missing information remains unknown.

**Transaction status**:
The latest known placement of a loaded transaction, such as confirmed, in a
mempool, or associated with an inactive block. Unknown placement is distinct
from a positive mempool observation.

**UTXO observation**:
A report that an output was unspent in a checked chain/mempool context. Missing
spending information alone does not establish that an output is unspent.

**Wallet UTXO**:
An outpoint associated with a wallet's derived scripts and observed unspent.
Its output, wallet association and unspent observation have distinct meanings.

**Annotation**:
Human-authored metadata attached to an investigation subject, such as a label,
note, tag or bookmark.

**Finding**:
A recorded analysis result with its scope and supporting information. Findings
distinguish observations, heuristic hypotheses and incomplete results.

**Connection scan**:
A bounded search for observed connections between transactions and outputs,
with retained results and supporting information. A graph is one way to choose
its targets and inspect its results, not what defines the search.

**Evidence**:
Information supporting a particular finding, decision or scan result. The term
does not denote the collection of all loaded chain data.

**Coverage**:
The subjects and bounds actually checked by an operation, including incomplete
or interrupted work. Completeness is relative to that scope.

**Stale result**:
A result whose supporting information or required freshness no longer suffices
to present it as current. Relevant changes depend on the result's meaning;
an unrelated refresh does not inherently invalidate it.

**Refresh**:
A renewed check of chain or wallet information. A successful refresh updates
what is known and when it was checked, while preserving unrelated human edits.

**Rerun**:
A new execution of an analysis or scan using its chosen scope and available
information. Refreshing its inputs alone does not recompute its conclusions.

**Presentation**:
The saved choices for viewing a Workspace, including graph membership,
visibility, selection and panels. Loaded data can exist outside the shown graph.
