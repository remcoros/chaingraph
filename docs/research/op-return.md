# OP_RETURN display decoding

Reviewed 2026-09-08.

Chaingraph recognizes output scripts whose first byte is `OP_RETURN` (`0x6a`).
For conventional data-carrier scripts, it parses literal data pushes after that
opcode, including the one-, two- and four-byte little-endian PUSHDATA lengths.
It checks the length field and available payload before every read. Additional
opcodes or truncated pushes retain the script tail as hex instead of presenting
an incomplete or invented message. This is display parsing, not script execution,
protocol interpretation, consensus validation or a relay-policy decision.

The independent parser follows the documented opcode encoding in Bitcoin Core's
[script definitions](https://github.com/bitcoin/bitcoin/blob/master/src/script/script.h)
and the byte-reading behavior in
[GetScriptOp](https://github.com/bitcoin/bitcoin/blob/master/src/script/script.cpp).
No source implementation was copied. Bitcoin Core is MIT licensed; Chaingraph's
new code is original MIT application code.

Each data push is decoded using the platform's UTF-8 `TextDecoder`, with fatal
decoding and BOM preservation as specified by the
[WHATWG Encoding Standard](https://encoding.spec.whatwg.org/#interface-textdecoder).
Invalid UTF-8 or binary control bytes display as hex. Line, formatting and
direction controls appear as visible escapes so message data cannot rearrange
the interface or spoof surrounding text. React renders the result as text only.
Ordinary Unicode remains readable, but a readable string does not identify a
message's author or establish that a protocol considers it text.

Multiple pushes retain visible boundaries, and exact data hex remains copyable.
A 72-code-point preview keeps rows compact. The expanded text is selectable,
scrollable and copyable. The parser bounds the complete script to 64 KiB before
allocation or decoding. Larger scripts are identified as OP_RETURN with an
explicit display-limit explanation; the existing advanced script inspection
retains access to original hex. This is an application UI budget, not a claim
about a Bitcoin data-carrier size limit.

Tests cover empty data, all push-length encodings, non-minimal pushes, multiple
pushes, malformed and truncated scripts, binary/invalid UTF-8, Unicode, invisible
characters, HTML-shaped text, preview truncation and the display budget.
