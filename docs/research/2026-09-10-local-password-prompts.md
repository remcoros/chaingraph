# Local workspace passwords and browser save prompts

Date: 2026-09-10

## Observation and applicability

A user reported Chrome sometimes offering to save a password when activating
ordinary application links. Code inspection found no Credential Management API
calls, no password controls in application navigation, and no password fields
retained after their dialogs close. Reveal controls already used explicit button
semantics. The create, unlock and encrypted-import dialogs did use native forms
and sign-in/sign-up autocomplete hints for local encryption passwords.

[Chromium's password-form guidance](https://www.chromium.org/developers/design-documents/create-amazing-password-forms/)
identifies navigation and removal of a password form as submission signals.
[Its form metadata guidance](https://www.chromium.org/developers/design-documents/form-styles-that-chromium-understands/)
identifies `current-password` and `new-password` as sign-in and sign-up hints.
These behaviors make a delayed prompt from an earlier local password action
plausible. This is an inference, not a reproduced root cause.
Chromium's documented
[password-manager state transitions](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/password_manager/core/browser/password_manager.h)
also distinguish native submission followed by navigation from other inferred
submission paths.

## Bounded mitigation and limits

Local encryption controls now use an accessible group and explicit action buttons,
with Enter handled for editable single-line fields. They do not dispatch native
form submissions. Password fields request `autocomplete="off"`, retain native
password masking, and retain their reveal controls and labels. No plaintext
passwords are added to storage, URLs, form payloads or logs.

This removes the application's native credential-submission signal. It cannot
promise suppression of browser password-manager UI. Chromium can infer submission
without a native submit event, and its
[security FAQ](https://chromium.googlesource.com/chromium/src/+/master/docs/security/faq.md)
explains that password fields can ignore `autocomplete="off"`. Browser profile,
extension and version behavior were not investigated, and no password store was
accessed. Existing browser-managed credentials are untouched.

Validation uses static React markup and direct keyboard-handler tests. No browser,
end-to-end or screenshot checks were run; Chrome prompt behavior remains
unverified. Architecture documentation records the application interaction choice.
