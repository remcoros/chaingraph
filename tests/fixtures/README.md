# Browser test fixtures

`bitcoin.ts` intercepts the two proxy endpoints with Playwright routes. It never launches a backend, loads an environment file or contacts a Bitcoin service; unexpected RPCs return an explicit error.

The account zpub and receive/change addresses are the published [BIP84 test vectors](https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki) (CC0) and contain no private material. Transaction IDs and records are synthetic, shaped like Core verbose responses, and are not represented as real blockchain data.

`laboratory.ts` builds three synthetic 150-input/150-output transactions for renderer and analysis tests. It is test-only and never ships as example data.

`npm run test:e2e` starts Vite on loopback port 4173 and uses installed Chromium. If Chromium is absent, run `npx playwright install chromium`; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects another binary.
