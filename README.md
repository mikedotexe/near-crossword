NEAR Crossword
==================

Wallet Login (FastNear)
=======================

Crossword auth and transaction flows now use FastNear:

- `@fastnear/api` + `@fastnear/wallet` are used for wallet session restore/connect/tx.
- Wallet options are supplied by a bundled manifest in [src/fastnearWalletManifest.js](/Users/mikepurvis/other/near-crossword/src/fastnearWalletManifest.js).
- Wallet login support is limited to `mainnet` and `testnet`.
- Solve/claim local signing for `submit_solution`, `claim_reward`, and `claim_reward_new_account` now uses `@fastnear/api` local key mode (`near.state.update` + `near.sendTx`).
- `near-seed-phrase` is intentionally retained for crossword seed phrase compatibility.

Crossword Package Fork
======================

- The crossword UI package is now consumed from your fork package scope: `@crosswordxyz/react-crossword`.
- The app consumes the published npm package (`@crosswordxyz/react-crossword@^6.0.0`).
- The app imports the stable utility entrypoint `@crosswordxyz/react-crossword/util` (no private `dist/*` imports).

Runtime and Package Manager
===========================

- Node is pinned to `20.x` (see [.nvmrc](/Users/mikepurvis/other/near-crossword/.nvmrc)).
- Package manager is Yarn Berry (`4.x`) in compatibility mode via [/.yarnrc.yml](/Users/mikepurvis/other/near-crossword/.yarnrc.yml) with `nodeLinker: node-modules`.
- Dependency lockfile is [yarn.lock](/Users/mikepurvis/other/near-crossword/yarn.lock).
- `package-lock.json` is intentionally ignored.
- `near-cli` is intentionally **not** a project dependency. Install it globally for local deploy workflows.
- Frontend runtime now uses **Next.js** (`pages` router) instead of Parcel.
- FastNear packages are pinned to exact versions in `package.json`:
  `@fastnear/api@0.9.13`, `@fastnear/wallet@0.9.13`,
  `@fastnear/near-connect@0.10.6`, and `@fastnear/utils@0.9.13`.

Frontend Routes
================

The app now uses native Next.js path routing:

- `/` marketing landing page
- `/play` live puzzle play flow
- `/create` wallet-gated puzzle creator flow
- `/claim` reward claim flow after solving
- `/claimed` claim success page
- `/empty` no-active-puzzle state
- `/ai-studio` AI campaign planning stub

Legacy compatibility bridge:

- Old hash links like `/#/create` and `/#/play` are redirected to the new path routes.
- Hash redirect usage is tracked with the `hash_bridge_redirect` analytics event during migration.
- Default transition policy: keep this bridge for two release cycles, then remove once usage is negligible.

AI Studio Stub Config
=====================

The current AI studio flow is frontend-only and stores drafts in localStorage (`aiCrosswordDraft`).
Smart contract and backend AI integration changes are intentionally deferred to a later phase.

Optional env vars:

- `NEXT_PUBLIC_NEAR_AI_ENABLED` (`false` by default)
- `NEXT_PUBLIC_MARKET_NEAR_AI_URL` (`https://market.near.ai` by default)
- `NEXT_PUBLIC_NEAR_AI_AGENT_ID` (optional placeholder)

Next.js Client Env Vars
========================

For browser-side NEAR config in Next.js, use:

- `NEXT_PUBLIC_NEAR_ENV` (`testnet` by default)
- `NEXT_PUBLIC_CONTRACT_NAME` (contract account id)
- `NEXT_PUBLIC_NEAR_AI_ENABLED` (`false` by default)
- `NEXT_PUBLIC_MARKET_NEAR_AI_URL` (`https://market.near.ai` by default)
- `NEXT_PUBLIC_NEAR_AI_AGENT_ID` (optional placeholder)

Client env precedence:

- Frontend runtime uses `NEXT_PUBLIC_NEAR_ENV` only (with `testnet` default).
- Shell-only envs like `NEAR_ENV` and `CONTRACT_NAME` are not used by browser-side routing/query flows.
- Prefer `.env.local` for local app config (see [.env.example](/Users/mikepurvis/other/near-crossword/.env.example)).

Missing contract behavior:

- If the configured contract account is missing or does not expose crossword view methods, landing (`/`) still renders.
- Task routes (`/play`, `/claim`, `/create`) show a concise configuration warning with setup guidance.
- Non-recoverable RPC/network failures still surface as initialization errors.

Analytics Events
================

The frontend tracks funnel events via `src/lib/analytics.js`:

- `landing_cta_create_click`
- `landing_cta_play_click`
- `hash_bridge_redirect`
- `create_connect_wallet_click`
- `wallet_connect_success`
- `wallet_connect_cancel_or_fail`
- `create_preview_generate`
- `create_commit_initiated`
- `create_commit_success`
- `create_commit_cancel_or_fail`
- `play_view_loaded`
- `claim_submit`
- `claim_success`

How to play with this contract
===============================
1. Clone the repo.

```
git clone https://github.com/near-examples/near-crossword.git
cd near-crossword
```

2. Next, make sure you have NEAR CLI by running:

  ```
  near --version
  ```

  If you need to install `near-cli`:

  ```
  npm install near-cli -g
  ```

3. Build the smart contract

```
cd contract
./build.sh
```

4. Run `near dev-deploy` to deploy the contract to `testnet`.
5. Create a crossword, let's say that the answer to your crossword is "many clever words"
6. Answer for your crossword from now on will be a seed phrase! Let's generate key pair out of it.

   ```bash
   near generate-key randomAccountId.testnet --seedPhrase='many clever words'
   ```

   Now this key pair will be store on your machine under `~/.near-credentials/testnet/randomAccountId.json`

7. We should add your puzzle to our contract. To do that run
   
   ```bash
   near call <contract-account-id> new_puzzle '{"answer_pk":"<generated-pk>"}' --accountId=<signer-acc-id> --deposit=10
   ```
   Where:
      - `contract-account-id` - Account on which contract is stored. If you have used `near dev-deploy` in the first step it was autogenerated for you. It should look like `dev-<random-numbers>`.
      - `generate-pk` - Public key from JSON generated in the step #4
      - `accountId` - your existing testnet accountId (you can create one at https://wallet.testnet.near.org/)
      - `deposit` - reword for the person who will solve this puzzle
   
   After this call your puzzle will be added to the NEAR Crossword contract. Share your Crossword with friends, the person who will be able to solve it will be able to generate the same key pair and get the reward. Let's do that in the following steps.

8. Pretend that we have solved the puzzle and generated the very same key pair. This time it should be stored at `~/.near-credentials/testnet/<contract-id>.json`. We are using `<contract-id>` here because in the next step we will need to sign the transaction with this acc.

Attention! If you are using the same machine, your old key pair from `<dev-acc>` will be overwritten! Save it in some other place if you need it. Keys are stored in `~/.near-credentials/testnet/` folder.

To generate the new key:
```bash
near generate-key <crossword-contract-id> --seedPhrase='many clever words'
```

Also, we need to have another key that will be used later to get the reward. Let's generate it.

```bash
near generate-key keyToGetTheReward.testnet
```

7. Let's call `submit_solution` function to solve this puzzle.

```bash
near call <contract-id> submit_solution '{"solver_pk":"<PK from keyToGetTheReward.testnet>"}' --accountId=<contract-id>
```

Puzzle solved! Let's get our reward!

8. To get the reward we need to call the `claim_reward` function with the function call key that we have added in the previous step. Before that call we should prepare the keys:

```bash
cp ~/.near-credentials/testnet/keyToGetTheReward.testnet.json ~/.near-credentials/testnet/<contract-id>.json
```

And now we can claim our reward:

```bash
near call <contract-id> claim_reward '{"receiver_acc_id":"serhii.testnet", "crossword_pk":"<PK from randomAccountId account>", "memo":"Victory!"}' --accountId=<contract-id>
```

Quick Start
===========

To run this project locally:

1. Prerequisites: Make sure you've installed [Node.js] 20.x and global `near-cli`
2. Install dependencies: `yarn install`
3. Optional (recommended): copy [.env.example](/Users/mikepurvis/other/near-crossword/.env.example) to `.env.local` and set `NEXT_PUBLIC_CONTRACT_NAME`.
4. Run the local full-stack workflow (dev deploy + frontend): `yarn dev:full`
5. Or run frontend only: `yarn dev`
6. Build production frontend: `yarn build` and serve with `yarn start`
7. See `package.json` for a
   full list of `scripts` you can run with `yarn`)

Frontend-only quick start with explicit contract:

- `NEXT_PUBLIC_CONTRACT_NAME=<your-contract.testnet> NEXT_PUBLIC_NEAR_ENV=testnet yarn dev`

Now you'll have a local development environment backed by the NEAR TestNet!

Go ahead and play with the app and the code. As you make code changes, the app will automatically reload.

Exploring The Code
==================

1. The "backend" code lives in the `/contract` folder. See the README there for
   more info.
2. The frontend uses Next.js `pages` routes (`/pages/index.js`, `/pages/play.js`, etc.).
   Shared app state and transaction flow helpers live in `/src/lib/appFlow.js`.
3. Tests: there are different kinds of tests for the frontend and the smart
   contract. See `contract/README` for info about how it's tested. The frontend
   test script is currently a placeholder.

Deploy
======

Every smart contract in NEAR has its [own associated account][NEAR accounts]. When you run `yarn dev:full`, your smart contract gets deployed to NEAR TestNet with a throwaway account. When you're ready to make it permanent, here's how.

Step 0: Install near-cli (required for local deploy scripts)
-------------------------------------

[near-cli] is a command line interface (CLI) for interacting with the NEAR blockchain. This repo expects it to be installed globally:

    npm install -g near-cli

Ensure that it's installed with `near --version`

Step 1: Create an account for the contract
------------------------------------------

Each account on NEAR can have at most one contract deployed to it. If you've already created an account such as `your-name.testnet`, you can deploy your contract to `crossword.your-name.testnet`. Assuming you've already created an account on [NEAR Wallet], here's how to create `crossword.your-name.testnet`:

1. Authorize NEAR CLI, following the commands it gives you:

      near login

2. Create a subaccount (replace `YOUR-NAME` below with your actual account name):

      near create-account crossword.YOUR-NAME.testnet --masterAccount YOUR-NAME.testnet

Step 2: set contract name in code
---------------------------------

Set `NEXT_PUBLIC_CONTRACT_NAME` (and optionally `NEXT_PUBLIC_NEAR_ENV`) for the frontend, preferably in `.env.local`.

Example:

    NEXT_PUBLIC_CONTRACT_NAME=crossword.YOUR-NAME.testnet
    NEXT_PUBLIC_NEAR_ENV=testnet

Step 3: deploy!
---------------

Build frontend with:

    yarn build

Then serve the production app with:

    yarn start

Troubleshooting
===============

On Windows, if you're seeing an error containing `EPERM` it may be related to spaces in your path. Please see [this issue](https://github.com/zkat/npx/issues/209) for more details.


  [React]: https://reactjs.org/
  [create-near-app]: https://github.com/near/create-near-app
  [Node.js]: https://nodejs.org/en/download/package-manager/
  [jest]: https://jestjs.io/
  [NEAR accounts]: https://docs.near.org/docs/concepts/account
  [NEAR Wallet]: https://wallet.testnet.near.org/
  [near-cli]: https://github.com/near/near-cli
