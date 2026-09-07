We're building a Bitcoin chain analysis / wallet labeling / address and transaction clustering tool.

Some ground rules:

- be creative, nothing here is set in stone, it mainly sets a first start and some overall goals and ideas, use the ideas and end-goals as a starting point for further research and implementation goals.
- create and keep up to date a well structured agentic repository in this working folder
- use subagents to paralelize work
- Research online about certain topics when unsure about details, and keep a log/references of those, so we can properly credit research material.
- If adding a certain ai skill and/or agent instructions would make sense at some point, add it to the local project.

Some overal ideas about frontend/backend:

frontend:

- web ui, responsive, possibly pwa / mobile friendly
- NOT a traditional on-chain explorer or dashboard
- More like a chain analysis tool for exploring activity, labeling, clustering and running custom algorithms (e.g. boltzmann (https://github.com/Samourai-Wallet/boltzmann and https://github.com/Copexit/am-i-exposed and CIOH (common input ownership heuristic), etc. etc., do some research))
- the primary interface should support a few different views, maybe tabs, and/or panels:
- the main view is an interactive 3D graph of transactions, addresses and utxos, with different options to influence how things are rendered (e.g. the size of nodes based on X or Y),
- tools to add labels, notes, icons to nodes and vertices (addresses, utxos, transactions, etc.)
- clustering and glowing effects and able to influence them
- custom analysis algorithms, options and tools can (interactively) influence the graph, like clustering, changing sizes, adding notes/icons, etc.
- input to quickly go to / add to the graph, specific transactions, utxos, addresses
- selected nodes/vertices/clusters/etc. in the graph should enable/disable(or hide when appropriate) ui elements, and show side-panels with additional information and available actions.
- should be user-friendly, interactive, context dependant.
- on first use, a 'guided-tour' (as often seen in LOB apps, showing new features or first time users the main different UI elements). Skippable and restartable (e.g. through a help/about menu). Not too long, but enough to guide through the basics.
- top level there is workspaces, can open multiple (top/header level tabs?), be opened/saved (local storage and to local disk, since its web-frontend), should indicate if it has changes (e.g. with * or icon)
- panels for visible utxos/transactions/addresses in the graph?
- maybe something like bookmarks
- options to add/import (an thus scan), an xpub/zpub/tpub to the workspace / graph
- I might have missed a few good points, but this is mainly to get the idea

backend
- NOT a full indexer, rely on raw bitcoin core rpc and electrum protocol (Fulcrum)

some general notes

- backend is pure a proxy/helper/scanner for the front-end, it does not handle storage or caching for the frontend. the front-end does client-side workspace/wallet storage, the back-end is the 'indexer/scanner' (it does not hold indexes itself).
- due to this, front-end is 'smart' and maybe can provide hints to the backend to improve performance/partial scans?
- should support mainnet and testnet4
- code architectured well into modules (but not overdone, keep the right abstractions)
- have tests, but not every little thing needs tests. complex things needs test (like security and cryptography)
- test overall functionality, regressions, end to end prefered, but keep it simple

other random thoughts

- main goals are to provide a more profesional on-chain analysis tool for personal wallets, hobbyists and mild experienced bitcoiners.
- for personal wallets, have insights in where coins come from and go to, able to practice good privacy, utxo management, labeling, etc.
- for on-chain analysis hobbyists a tool to follow on-chain activity and label it
- run custom analysis and on-chain heuristics with an IDE like  interactive 3D overview

Work methodically, do research, learn, be bold. Keep the goals and overall ideas in mind, but don't be shy if you find something better.

- You can read .env.example, which I copied from another project, it contains the (example) env vars of bitcoin core and fulcrum testnet4 instances. In this directory is also a .env.live file with real credentials. You can use (but not read this file), these env vars for testing while implementing.

Based on this, do you have any further questions?


1. I think a cool idea would be to have 'wallets' a whole panel/concept within workspaces, so you can add/import multiple
2. fully self-hosted, it's primary audience is for personal wallets and hobbyists. this means that some shortcuts can be taken because for the frontend/backend we don't have to take privacy into account much. This should also be clearly stated in e.g. a README.md.
3. MIT ftw
4. 'custom algos' might be a bit much, analysis tools and algorithms, easily extendable in the codebase maybe?
5. unlike what's said in 2, I think it's still best to not put too much (if any) scanning functionality in the backend, the frontend should do most of the work here. That means, it should query/pull through websocket or whatever new transactions/address info/etc. for on-chain activity.
good point about security if we are saving xpubs and stuff, let's encrypt and provide password functionality for workspaces.
6. ideally, we should be able to add/render a few big coins joins, paths into and out of them (think: 150 input/output coinjoins), so it will add up quickly, webgl a good 3D web engine would be needed for sure.

I won't be here until the morning, so keep on going until a first  testable solution is finished, or until a real breaking issue is stopping you. go crazy, let's go!
