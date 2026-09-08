# Browser test fixtures

`bitcoin.ts` intercepts the browser's two proxy endpoints with Playwright routes. It never launches a backend, loads an environment file, or contacts a Bitcoin service. Unexpected fixture RPCs return an explicit error.

The account zpub and receive/change addresses are the published [BIP84 test vectors](https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki), licensed CC0. They contain no private material. Transaction hashes and transaction records are deliberately synthetic: they are shaped like Core verbose responses to exercise UI loading, graph paths, labeling, and client-side discovery. They are not represented as transactions from the blockchain.

The test-only `laboratory.ts` fixture exercises graph rendering and reversible analysis using three synthetic 150-input / 150-output transactions. Browser tests unlock it through encrypted saved-workspace storage; it is never shipped as application example data.

Run `npm run test:e2e`. Playwright starts Vite on loopback port 4173 and uses installed Chromium (including a detected local Playwright cache). If Chromium is absent, run `npx playwright install chromium`. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can specify another installed binary.
