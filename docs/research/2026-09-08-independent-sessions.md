# Independent CLI reviews and UI experiments

Verified 2026-09-08 against installed Copilot CLI 1.0.83, the installed Codex CLI and primary documentation. These are local worktree reviews; no GitHub pull request or publication was created.

## Copilot isolation and model selection

`copilot help config` lists the exact model identifiers `claude-opus-4.8` and `kimi-k3`. Each independent session was launched in its own Herdr worktree with `--model <id> --effort high --context long_context`. Both session-start records confirmed the requested model, `reasoningEffort: high` and `contextTier: long_context`. This verifies selection, not a fabricated numeric context limit.

Each session used a new `COPILOT_HOME` containing only explicit review settings: memory and hooks disabled, IDE auto-connect disabled, dynamic skill retrieval disabled, and all discovered skills listed in `disabledSkills`. Discovery verification showed every listed skill disabled. `--no-custom-instructions` prevented repository instruction loading, `--disable-builtin-mcps` disabled the built-in GitHub connector, `--no-remote --no-remote-export` kept the session out of the remote UI, and the task tool was excluded to keep the requested model responsible for its work. Prompt mode does not enable memory by default. No previous conversation or review findings were supplied.

GitHub CLI authentication was passed to the process in memory without printing or copying the token, and was marked secret for child-tool environments. Environment files and personal browser state were excluded from the review scope. Skills and custom instructions were disabled through actual CLI settings rather than relying solely on a prompt. These controls isolate context and configuration; a git worktree is not an operating-system security sandbox.

Opus reviews and implements UI/interactivity improvements on `review/opus-ui`. Kimi reviews cryptography, data validity, persistence and backend behavior on `review/kimi-security`. Both start from `e2809c4`. Findings and integration outcomes belong in the review record, not in claims about which model is better.

## Codex experiments

Fresh Codex exec sessions use `--ignore-user-config --ephemeral`, disabled memories/plugins/skill search/apps/multi-agent/hooks, skipped host skill discovery, disabled bundled skill instructions, zero project-document loading and high reasoning effort. Authentication remains available without copying user configuration. Standalone briefs repeat the product and privacy boundaries.

- `experiment/custom-three-graph` explores a purpose-built Three.js renderer without design skills.
- `experiment/tracing-studio` explores an alternative editing/navigation layout. It is allowed only the explicitly supplied Anthropic frontend-design guidance, with the no-memory and product constraints taking precedence. That guidance is consulted as external reference material, not copied into application code.

Every worktree installs separate dependencies and uses separate preview/test ports. The coordinator reviews source and test evidence before integrating foundation changes. Experimental designs remain independently inspectable local branches until comparison justifies adoption.

## Primary sources

- [Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference): prompt mode, model selection, authentication and session controls.
- [Copilot configuration directory reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference): separate `COPILOT_HOME`, settings, disabled skills and context configuration.
- [Copilot supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models): model availability; exact installed IDs were additionally verified through CLI help and session records.
- [Copilot custom providers](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models): BYOK configuration was researched but is not needed for these GitHub-routed models. No custom endpoint or invented token limits were configured.
- [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands#codex-exec): fresh exec runs, ephemeral output and configuration isolation.
- [Anthropic frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design): the explicitly selected design reference for one experiment.
- [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax): scoped token permissions and check-run concurrency.
- [Docker Compose pull](https://docs.docker.com/reference/cli/docker/compose/pull/): explicitly refresh the selected image before upgrading an existing deployment.

The initial Copilot commands also named a nonexistent `skill` tool in the tool exclusion list. The CLI warned and ignored that extra name; skill disabling itself was verified through `disabledSkills` and was effective. Subsequent launcher commands omit the unsupported tool name.

## Follow-up foundation reviews

After integration at `0b0b271`, fresh isolated Copilot sessions review the new
transaction/script, tag and wallet-refresh code in `review/opus-foundation` and
`review/kimi-foundation`. CLI session-start metadata again confirms exact
`claude-opus-4.8` and `kimi-k3`, `high` effort and `long_context`. New per-session
configuration directories retain disabled memory, hooks, dynamic skill retrieval,
IDE attachment and all four discovered skills. Authentication is supplied in the
child process environment, without copying authentication files. No context token
count is inferred from the tier name.

Clean Codex followups rebase the original custom renderer and studio layout onto
that same foundation. They use committed source and standalone prompts, not
inherited conversation, skill instructions or memories. The shared graph boundary
was independently tested before this rebase. Final branch outcomes are recorded in
the experiment and review reports once their checks complete.
