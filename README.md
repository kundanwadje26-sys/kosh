# Kosh — personal expense tracker & fund manager

Kosh is a single-page web app that runs entirely in your browser and is hosted free on GitHub Pages. There is no server and no database: your data lives in one file, `data.json`, inside a **private** GitHub repository that only you can see. The app reads and writes that file through the GitHub REST API using a personal access token.

The app is three files:

| File | What it does |
|---|---|
| `index.html` | The page skeleton. Loads Tailwind, fonts, icons, Chart.js and JSZip from CDNs. |
| `styles.css` | Colours, typography and component styles. |
| `app.js` | Everything else: data model, calculations, pages, forms, export, and the GitHub sync engine. |

---

## Part 1 — How it works (2-minute read)

You will create **two** repositories on GitHub:

1. **`kosh`** (public) holds the three app files. GitHub Pages turns it into a website at `https://YOUR-USERNAME.github.io/kosh/`. It must be public because free GitHub Pages only works on public repositories. It contains no personal data, only code.
2. **`kosh-data`** (private) holds `data.json`, your actual finances. Nobody but you can see it.

When you add a transaction, Kosh saves it in your browser immediately (so the app feels instant and works offline), then about a second later it:

1. downloads the latest `data.json` from `kosh-data`,
2. applies your new changes on top of it,
3. commits the updated file back to the repository.

Every save becomes a commit, so GitHub keeps a full history of your data. If you ever make a mess you can look at or restore any earlier version from the repository's commit history.

---

## Part 2 — Setup, step by step

Budget about 20 minutes. You need a computer for setup; afterwards you can use Kosh on your phone too.

### Step 1: Create a GitHub account

1. Go to <https://github.com/signup>.
2. Enter your email, create a password, and choose a **username**. Write the username down; it becomes part of your app's address.
3. Verify your email when GitHub asks.

### Step 2: Create the private data repository

1. While signed in, click the **+** icon at the top-right of any GitHub page, then **New repository**.
2. **Repository name:** `kosh-data`
3. Select **Private**. This matters: it keeps your finances hidden.
4. Tick **Add a README file**. (The repository needs at least one file so it has a `main` branch. Kosh will create `data.json` by itself.)
5. Click **Create repository**.

### Step 3: Create the public app repository and upload the files

1. Click **+** → **New repository** again.
2. **Repository name:** `kosh` (any name works, but it becomes part of the web address).
3. Select **Public**.
4. Tick **Add a README file**, then **Create repository**.
5. On the new repository's page, click **Add file** → **Upload files**.
6. Drag in **`index.html`, `styles.css` and `app.js`**. Upload them loose, not inside a folder, so `index.html` sits at the top level of the repository. (Uploading this `README.md` too is fine but optional.)
7. Scroll down and click **Commit changes**.

### Step 4: Turn on GitHub Pages

1. In the `kosh` repository, click **Settings** (the tab with the gear icon along the top of the repository).
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Under **Branch**, choose **`main`** and folder **`/ (root)`**, then click **Save**.
5. Wait 1–3 minutes, then refresh the Pages settings screen. It will show *"Your site is live at `https://YOUR-USERNAME.github.io/kosh/`"*. Open that link to confirm the app loads. It will say it's saving on this device only; that's expected until you finish Step 6.

### Step 5: Create a personal access token (the app's key to your data)

A fine-grained token lets Kosh touch **only** the `kosh-data` repository and nothing else in your account.

1. Click your profile picture (top-right) → **Settings**.
2. Scroll to the bottom of the left sidebar → **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
4. Fill in:
   - **Token name:** `Kosh app`
   - **Expiration:** pick a date (90 days or 1 year is sensible). When it expires the app will tell you and you just create a new one.
   - **Resource owner:** your username.
   - **Repository access:** choose **Only select repositories**, then pick **`kosh-data`**.
   - **Permissions → Repository permissions → Contents:** change it to **Read and write**. (GitHub automatically adds *Metadata: Read-only*; leave it.) Don't grant anything else.
5. Click **Generate token**.
6. **Copy the token now** (it starts with `github_pat_`). GitHub shows it only once. Keep it somewhere safe, such as a password manager, until Step 6.

> Never paste your token into chats, emails, screenshots or code files. Anyone with it can read and change your data repository.

### Step 6: Connect the app to GitHub

1. Open `https://YOUR-USERNAME.github.io/kosh/`.
2. Click **Settings** (bottom of the sidebar; on a phone, open the menu first).
3. Fill in:
   - **GitHub username:** your username
   - **Data repository name:** `kosh-data` (you can also paste `username/kosh-data` or the full repository URL)
   - **Branch:** `main`
   - **File path:** `data.json`
   - **Personal access token:** paste the token
4. Click **Test connection**. You should see *Connected*. If it warns that the repository is **PUBLIC**, go back and make `kosh-data` private (repository Settings → General → Danger Zone → Change visibility).
5. Click **Save settings**. The status chip at the top should change to **Synced**. Open your `kosh-data` repository on GitHub and you'll see a new `data.json` file.

Setup is done.

### Step 7: Using it on your phone or a second computer

1. Open the same `https://YOUR-USERNAME.github.io/kosh/` link on the other device.
2. Open **Settings** and enter the same details and token (or create a separate token for each device, which lets you revoke one without affecting the others).
3. Save. Kosh downloads your data from GitHub.

Tip: on your phone, use the browser's **Add to Home screen** option to get an app-like icon.

---

## Part 3 — First-time walkthrough

The dashboard shows a short *Set up Kosh in three steps* checklist until you've connected GitHub, added accounts and logged a first transaction. A good order:

1. **Accounts → Add account.** Add each bank account, credit card and investment. For each one, enter today's balance as the **opening balance** and today's date as the **opening date**. For a credit card, the opening balance is what you currently owe; also enter the credit limit, statement day and payment due day. *Cash in hand* already exists; use **Update balance** on it to set how much cash you have.
2. **EMIs & loans → Add EMI or loan.** Add existing card EMIs and loans. If a loan started earlier, enter **EMIs already paid** so the remaining principal is correct.
3. **Subscriptions → Add subscription.** Netflix, gym, software and so on, with the next renewal date and the account or card it's charged to.
4. **Budgets** (optional). Set monthly limits per category.
5. From then on, use the **+** button (bottom-right) to log expenses, income and transfers as they happen.

### How to record common situations

| Situation | What to log |
|---|---|
| Bought groceries with a card | Expense, paid from that card |
| Salary arrived | Income, source *Salary*, into your bank |
| Withdrew cash at an ATM | Transfer, from bank to *Cash in hand* |
| Paid the credit card bill | Accounts → the card → **Pay bill** (a transfer from bank to card, prefilled with the outstanding amount) |
| Bought something on no-cost EMI | Add it under **EMIs & loans** only, don't also log the purchase as an expense. Each month's installment is recorded as an expense on the card, and the unpaid principal blocks the card's limit. |
| Mutual fund value went up | Accounts → the investment → **Update value** (records a balance adjustment, not income) |
| Put money into a mutual fund / FD | Transfer, from bank to the investment account |
| Bank balance doesn't match the app | **Update balance** on that account and enter the real figure |

**Why "opening balance + opening date"?** Kosh never stores balances directly. It calculates them as *opening balance + everything that came in − everything that went out* since the opening date. That means balances can never drift out of sync with your transactions, and deleting a transaction fixes the balance automatically. Transactions dated before an account's opening date are kept for history but don't change its balance (they're already included in the opening figure).

---

## Part 4 — What each module does

**Dashboard.** Net worth shown as an equation: *Cash + Bank + Investments − Card dues − Loans − Card EMIs = Net worth*, with bars sized to each figure. Below it: this month's income, spending and savings rate; a pie chart of spending by category; a bar chart of income vs expenses for the last 6 months; upcoming EMIs, subscription renewals and credit card due dates for the next 30 days; and your budgets.

**Accounts.** Cash, bank accounts, credit cards and investments. Cards show outstanding, EMI-blocked amount, available limit, utilisation, the current statement date and payment due date. Accounts you no longer use can be archived (hidden but kept in history).

**Transactions.** All entries with filters by month, type, account and category, plus text search.

**EMIs & loans.** Card EMIs and loans (home, car, personal, education, other) with principal, interest rate, tenure, EMI amount, EMIs paid, remaining months and remaining principal. **Record payment** records that month's installment as an expense. **Schedule** shows the full month-by-month amortisation table. If you tick *Record each EMI automatically*, Kosh logs each EMI when you open the app on or after its due date.

**Subscriptions.** Recurring payments with weekly, monthly, quarterly, half-yearly or yearly frequency and a linked account or card. Monthly and yearly totals are shown. Can also be recorded automatically.

**Budgets.** A monthly limit per category, with progress bars that turn amber near the limit and red when over.

**Data.** Export and backup tools (next section).

---

## Part 5 — Exporting to Power BI, Excel or Power Automate

Open **Data** and click **Download all (ZIP)**. Single tables can also be downloaded as individual CSVs. The ZIP contains flat, one-row-per-record CSV files that share ID columns so they join cleanly:

| File | One row per | Key columns |
|---|---|---|
| `accounts.csv` | account | `account_id`, type, current balance |
| `transactions.csv` | transaction | `transaction_id`, `from_account_id`, `to_account_id`, `signed_amount`, `year`, `month` |
| `ledger.csv` | movement in or out of one account (a transfer produces two rows) | `account_id`, `amount` (+ in / − out), `affects_balance` |
| `emis.csv` | EMI or loan | `emi_id`, `account_id` |
| `emi_schedule.csv` | EMI installment | `emi_id`, installment number, principal, interest, balance |
| `subscriptions.csv` | subscription | `subscription_id`, `account_id` |
| `budgets.csv` | budget | `category` |
| `categories.csv` | category | `category`, `kind` |
| `kosh-data.json` | — | complete backup of everything |

A `README.txt` inside the ZIP lists the column meanings and the relationships.

**Power BI quick start.** *Get data → Text/CSV*, load the files, then in *Model view* relate `accounts[account_id]` → `ledger[account_id]`, `accounts[account_id]` → `transactions[from_account_id]` (and an inactive one to `to_account_id`), `emis[emi_id]` → `emi_schedule[emi_id]`. For balance-over-time charts use `ledger.csv` filtered to `affects_balance = TRUE`; running total of `amount` by date gives each account's balance. All CSVs are UTF-8 with a BOM, so Excel opens rupee symbols and Hindi/Marathi text correctly.

**Power Automate.** Because `data.json` lives in GitHub, a flow can read it directly with an HTTP action: `GET https://api.github.com/repos/USERNAME/kosh-data/contents/data.json` with headers `Authorization: Bearer YOUR_TOKEN` and `Accept: application/vnd.github.raw+json`. The response is the JSON itself (arrays `accounts`, `transactions`, `emis`, `subscriptions`, `budgets`), ready for *Parse JSON*. Use a separate read-only token for flows (Contents: Read-only).

**Backups and restore.** *Download JSON* saves the complete database. *Restore from a backup → Choose backup file* replaces everything with a backup file (and syncs that to GitHub). GitHub's commit history is a second, automatic backup.

---

## Part 6 — Where the GitHub code is (if you want to change it)

All GitHub logic is in `app.js` and heavily commented. Search for these names:

| Name | What it does |
|---|---|
| `STORAGE_KEYS` | The localStorage keys: data cache, pending changes queue, connection settings, last sync time. |
| `gh()` | The GitHub REST API client: `checkRepo`, `checkBranch`, `getFile` (GET contents, handles files over 1 MB), `putFile` (PUT contents with the file's `sha`). API base URL, headers and API version are set here. |
| `toBase64` / `fromBase64` | Unicode-safe Base64 conversion (GitHub requires file content in Base64). |
| `commit()` | Every change in the app goes through this. It applies the change locally, saves it to the pending queue and schedules a sync. |
| `runSync()` | The fetch → merge → commit loop. If someone else (another device) committed in between, GitHub answers `409 Conflict`; Kosh then re-downloads and re-applies your changes, retrying up to 4 times. |
| `scheduleSync()` | Batches rapid changes into one commit (waits 700 ms after the last change). |
| `connectAndSync()` | First connection logic, including the "merge or discard" question when both this device and GitHub already have data. |

To point the app at a different repository you don't need to edit code — just change the fields in Settings. Branch and file path can be anything (e.g. `finance/2026.json`); Kosh creates the file if it doesn't exist.

To add your own categories, open **Settings → Preferences** and edit the category lists. Currency (INR by default, with Indian lakh/crore grouping) is also chosen there.

---

## Part 7 — Security and privacy notes

- **Your token is stored only in this browser's localStorage.** It's never sent anywhere except `api.github.com`. Anyone who can use your browser profile, or any malicious browser extension, could read it. Don't connect Kosh on shared or public computers; if you must, use **Settings → Forget token** and **Clear data on this device** afterwards.
- **Keep the data repository private.** The Test connection button warns you if it isn't.
- **Scope the token to one repository** with only *Contents: Read and write*, and give it an expiry date. If you think it has leaked, delete it at GitHub → Settings → Developer settings → Personal access tokens, then create a new one.
- The app page has a `noindex` tag so search engines won't list it, but the app repository itself is public. That's fine: it contains only code.

---

## Part 8 — Offline use and limits

- If you lose internet, keep using the app. Changes are queued on the device (the chip shows **Offline** or **N pending**) and pushed automatically when you're back online.
- The **first** time a device opens the app it needs internet to load Tailwind, fonts, icons and charts from their CDNs. After that the browser usually caches them, but a fully offline cold start isn't guaranteed.
- If two devices edit while both are offline, both sets of changes are merged when they sync. If both edited the *same* entry, the one that syncs last wins.
- GitHub's API allows 5,000 requests per hour per token, far beyond what personal use needs. The Contents API handles files up to 100 MB; a decade of personal transactions is typically a few MB.
- The browser console shows a warning that the Tailwind CDN "should not be used in production". It's harmless for a personal app.

---

## Part 9 — Troubleshooting

| Message or symptom | Cause and fix |
|---|---|
| **GitHub rejected the token** (401) | Token expired, was revoked, or wasn't pasted completely. Create a new token (Step 5) and paste it in Settings. |
| **Permission denied** (403) | The token doesn't include `kosh-data`, or *Contents* isn't *Read and write*. Edit the token at GitHub → Developer settings, or create a new one. |
| **Repository not found** (404) | Username or repository name is misspelled, or the token wasn't given access to that repository. GitHub returns 404 (not 403) for private repositories the token can't see. |
| **Branch not found** | The data repository has no commits. Add a README to it (Step 2.4), or check the branch name (`main` vs `master`). |
| Status stuck on **Pending** | Click the status chip (or **Data → Sync now**) to retry. Check you're online. If an error chip appears, click it for details. |
| Site shows **404** at github.io | Wait a few minutes after enabling Pages; confirm `index.html` is at the top level of the `kosh` repository (not inside a folder) and the Pages branch is `main` / root. |
| Changes don't appear on another device | Open **Data → Reload from GitHub** on that device, or just refresh the page. |
| Page looks unstyled | A CDN failed to load (network, ad-blocker or firewall). Refresh, or try another network. |

---

## Part 10 — What was added beyond the original brief

- **Loans and card EMIs count as liabilities in net worth**, not only card dues, so the number reflects what you really owe.
- **Two-repository design** (public app, private data) and a narrowly scoped fine-grained token.
- **Conflict-safe sync**: offline queue, batching, automatic merge and retry when two devices commit at once, readable commit messages.
- **Balances calculated from transactions** (never stored), plus **balance / value updates** for reconciling banks and marking investments to market.
- **Credit card statement and due dates**, utilisation, one-click **Pay bill**.
- **EMI amortisation schedule**, remaining principal, prepaid/closed EMIs, and support for loans that started before you began tracking.
- **Automatic recording** of EMIs and subscriptions on their due dates (optional per item, duplicate-proof across devices).
- **Monthly budgets** per category with dashboard warnings.
- **Search and filters** for transactions; **account archiving**.
- **Ledger export** (one row per account movement) for accurate balance-over-time reports, an EMI schedule export, and CSVs protected against spreadsheet formula injection.
- **JSON backup and restore**, reload from GitHub, forget token, clear device data, and a connection tester that warns about public repositories.
- Multiple currencies with Indian number formatting by default, mobile-friendly layout, keyboard accessibility and reduced-motion support.
