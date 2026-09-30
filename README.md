# Kundan's Finance

**KOSH: Kundan On Savings Hustle.** A personal expense tracker, fund manager and investment portfolio.

Kundan's Finance is a single-page web app that runs entirely in your browser and is hosted free on GitHub Pages. There is no server and no database: your data lives in one file, `data.json`, inside a **private** GitHub repository that only you can see. The app reads and writes that file through the GitHub REST API using a personal access token.

The app is these files (upload all of them, keeping the `icons` folder):

| File | What it does |
|---|---|
| `index.html` | The page skeleton. Loads Tailwind, fonts, icons, Chart.js and JSZip from CDNs. |
| `styles.css` | Colours, typography and component styles. |
| `app.js` | Everything else: data model, calculations, pages, forms, SIPs, import, insights, export, and the GitHub sync engine. |
| `sw.js` | Service worker: lets the installed app open offline and load fast. |
| `manifest.webmanifest` | App name, icon and colours for "Add to Home Screen". |
| `icons/` | Home-screen icons (iPhone and Android). |

---

## Already using the earlier version? Update without losing anything

Your data is not in these files; it lives in `data.json` in your private `kosh-data` repository (and a copy in each browser). The new version reads the same file and the same browser storage, and only adds empty lists for new features (SIPs, charts, goals, wishlist, import rules, tax items). Nothing is renamed, moved or deleted.

1. **Optional safety step:** open the app, go to **Export & backup → Download JSON**, and keep the file.
2. Open your **public** app repository (`kosh`) on GitHub → **Add file → Upload files**.
3. Unzip the download and drag in **everything**: `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest` and the **`icons` folder** (drag the folder itself; GitHub keeps it as a folder). Files with the same name are replaced. Click **Commit changes**.
4. Wait 1–2 minutes for GitHub Pages to update.
5. On **every** device you use (laptop, phone), open the app and do a hard refresh so the browser picks up the new files: **Ctrl + Shift + R** on Windows, **Cmd + Shift + R** on Mac. On a phone, close the tab completely and reopen it (or clear the site's cache).
6. You're done. Settings, token and data carry over. You don't need to reconnect GitHub.

Don't touch the `kosh-data` repository, and don't rename either repository; the app looks for them by name.

---

## Part 1 — How it works (2-minute read)

You will create **two** repositories on GitHub:

1. **`kosh`** (public) holds the three app files. GitHub Pages turns it into a website at `https://YOUR-USERNAME.github.io/kosh/`. It must be public because free GitHub Pages only works on public repositories. It contains no personal data, only code.
2. **`kosh-data`** (private) holds `data.json`, your actual finances. Nobody but you can see it.

When you add a transaction, the app saves it in your browser immediately (so the app feels instant and works offline), then about a second later it:

1. downloads the latest `data.json` from `kosh-data`,
2. applies your new changes on top of it,
3. commits the updated file back to the repository.

Every save becomes a commit, so GitHub keeps a full history of your data. If you ever make a mess you can look at or restore any earlier version from the repository's commit history.

---

## Part 2 — Setup, step by step

Budget about 20 minutes. You need a computer for setup; afterwards you can use the app on your phone too.

### Step 1: Create a GitHub account

1. Go to <https://github.com/signup>.
2. Enter your email, create a password, and choose a **username**. Write the username down; it becomes part of your app's address.
3. Verify your email when GitHub asks.

### Step 2: Create the private data repository

1. While signed in, click the **+** icon at the top-right of any GitHub page, then **New repository**.
2. **Repository name:** `kosh-data`
3. Select **Private**. This matters: it keeps your finances hidden.
4. Tick **Add a README file**. (The repository needs at least one file so it has a `main` branch. the app will create `data.json` by itself.)
5. Click **Create repository**.

### Step 3: Create the public app repository and upload the files

1. Click **+** → **New repository** again.
2. **Repository name:** `kosh` (any name works, but it becomes part of the web address).
3. Select **Public**.
4. Tick **Add a README file**, then **Create repository**.
5. On the new repository's page, click **Add file** → **Upload files**.
6. Drag in **`index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`** and the **`icons` folder**. Upload the files loose, not inside another folder, so `index.html` sits at the top level of the repository (only the icons stay in `icons/`). Uploading this `README.md` too is fine but optional.
7. Scroll down and click **Commit changes**.

### Step 4: Turn on GitHub Pages

1. In the `kosh` repository, click **Settings** (the tab with the gear icon along the top of the repository).
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Under **Branch**, choose **`main`** and folder **`/ (root)`**, then click **Save**.
5. Wait 1–3 minutes, then refresh the Pages settings screen. It will show *"Your site is live at `https://YOUR-USERNAME.github.io/kosh/`"*. Open that link to confirm the app loads. It will say it's saving on this device only; that's expected until you finish Step 6.

### Step 5: Create a personal access token (the app's key to your data)

A fine-grained token lets the app touch **only** the `kosh-data` repository and nothing else in your account.

1. Click your profile picture (top-right) → **Settings**.
2. Scroll to the bottom of the left sidebar → **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
4. Fill in:
   - **Token name:** `Kundan's Finance`
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
3. Save. The app downloads your data from GitHub.

### Step 8: Install it as an app on your iPhone

1. Open `https://YOUR-USERNAME.github.io/kosh/` in **Safari** (it must be Safari on iPhone).
2. Tap the **Share** button (square with an arrow), scroll down, tap **Add to Home Screen**, then **Add**.
3. A **KOSH** icon appears on your home screen. It opens full-screen like a normal app, remembers your settings, and works offline once opened online.
4. The first time you open the installed app, enter your GitHub details in Settings again (iPhone keeps home-screen apps separate from Safari).

On Android (Chrome) or a computer (Chrome/Edge), the dashboard shows an **Install** button, or use the browser menu → *Install app*.

---

## Part 3 — First-time walkthrough

The dashboard shows a short *Get KOSH ready in three steps* checklist until you've connected GitHub, added accounts and logged a first transaction. A good order:

1. **Accounts → Add account.** Add each bank account, credit card and investment. For each one, enter today's balance as the **opening balance** and today's date as the **opening date**. For a credit card, the opening balance is what you currently owe; also enter the credit limit, statement day and payment due day. *Cash in hand* already exists; use **Update balance** on it to set how much cash you have.
2. **EMIs & loans → Add EMI or loan.** Add existing card EMIs and loans. If a loan started earlier, enter **EMIs already paid** so the remaining principal is correct.
3. **Portfolio.** Add each mutual fund and stock by searching its name, then enter units and average cost. Add FDs and others with their current value. Then add your SIPs (details in Part 4).
4. **Subscriptions → Add subscription.** Netflix, gym, software and so on, with the next renewal date and the account or card it's charged to.
5. **Budgets** (optional). Set monthly limits per category.
6. From then on, use the **+** button (bottom-right) to log expenses, income and transfers as they happen.

### How to record common situations

| Situation | What to log |
|---|---|
| Bought groceries with a card | Expense, paid from that card |
| Salary arrived | Income, source *Salary*, into your bank |
| Withdrew cash at an ATM | Transfer, from bank to *Cash in hand* |
| Paid the credit card bill | Accounts → the card → **Pay bill** (a transfer from bank to card, prefilled with the outstanding amount) |
| Bought something on no-cost EMI | Add it under **EMIs & loans** only, don't also log the purchase as an expense. Each month's installment is recorded as an expense on the card, and the unpaid principal blocks the card's limit. |
| A SIP is due on the 1st | Nothing. It's recorded on the day and its units are added once the NAV is out. Compare with your statement if you like (list icon on the holding). |
| Bought more shares or a lump sum in a fund | **+** on that holding (a transfer from your bank). Fund units are added automatically; for shares, enter them when asked under *Units to confirm*. |
| Mutual fund or stock price changed | Nothing, if it's linked; the value updates itself. |
| FD, PPF or gold value went up | Accounts → the investment → **Update value** (records a balance adjustment, not income) |
| Put money into a mutual fund / FD | Transfer, from bank to the investment account |
| Bank balance doesn't match the app | **Update balance** on that account and enter the real figure |

**Why "opening balance + opening date"?** The app never stores balances directly. It calculates them as *opening balance + everything that came in − everything that went out* since the opening date. That means balances can never drift out of sync with your transactions, and deleting a transaction fixes the balance automatically. Transactions dated before an account's opening date are kept for history but don't change its balance (they're already included in the opening figure).

---

## Part 4 — What each module does

**Dashboard.** A greeting for you, then net worth shown as an equation: *Cash + Bank + Investments − Card dues − Loans − Card EMIs = Net worth*, with bars sized to each figure. Two small switches at the top right of that card let you leave out **Investments** (your portfolio) or **Card dues** (unpaid credit card bills). The figure and the equation update straight away, a small label shows what's left out, and the choice is saved so every device shows the same. Card EMIs and loans always count. To hide the switches, untick **Settings → Show the net worth switches on the dashboard**. Below it: this month's money in, spent, invested and left over; a portfolio card (value, profit, monthly SIPs, next SIP date, SIPs waiting for review); a chart of where the money went; a 6-month chart of money in vs spent and invested; everything due in the next 30 days (SIPs, SIP reviews, EMIs, subscriptions, card bills and FD maturities, each colour-coded); and your budgets. At the bottom are **Your charts** (below).

**Charts (your own graphs).** Click **New chart** (on the dashboard or the **Charts** page):

1. **Pick the type of chart** (18): bar, horizontal bar, stacked bar, 100% stacked bar, line, area, stacked area, bar + line, pie, doughnut, polar area, radar, treemap, waterfall, progress bars, heatmap, big number, and table.
2. **Pick what it shows** (45 options, grouped). The list only offers what suits the chart type:
   - *Money with me:* money with me now (cash and bank) by account, money with me at each month end, what I own and what I owe by kind, all balances, net worth and assets vs liabilities over time.
   - *Spending:* by category (with or without SIPs), number of expenses per category, by account or card, by payment mode (cash, bank, card), by description (shop or merchant), biggest single expenses, by day of the week, by month, by category month by month, average per day, this month vs last month day by day, and card spending per card.
   - *Income and savings:* income by source and by month; money in, spent and invested; money left over; savings rate (%); a waterfall of money in → spent → invested → left over; invested by month.
   - *Budgets, bills and loans:* budget vs spent, budget used (%), card dues and limit used (%) per card, loan amount left, EMI per loan, subscription costs, and fixed monthly outgoings (EMIs, subscriptions, SIPs).
   - *Portfolio:* by type, holdings by value, invested vs current value, profit or loss, return (%), monthly SIP by fund.
   - *Heatmaps:* spending by category, account or weekday against months, and a daily spending calendar.
3. **Set the details:** period (including Indian financial years), how many of the biggest items to show (the rest become *Other*), and **data labels**: values, % of total, both, or none.
4. **Filters on the chart:** tick Period, Category, Account or card, or Investment type (only the ones that suit the chart are offered). They appear as small drop-downs at the chart's top right, so you can switch, say, a spending chart to one card or one category without editing it. Each device remembers what you last picked.
5. **Colours:** every category, account, holding and series has one colour that is used in every chart, including the built-in dashboard charts and the portfolio. The builder lists the colours in the chart; click one to change it. Your choice then applies everywhere that item appears (use *reset* to go back). Heatmaps and big-number charts have a single colour of their own. **Settings → Reset chart colours** undoes all your colour picks.
6. Give it a title and size if you like, leave **Pin to the dashboard** ticked, and **Save**. A live preview shows the result as you go.

Pinned charts appear at the bottom of the dashboard every time the app is opened, on any device, because they're saved in your data file. Use the pin icon on a chart to unpin it (it stays on the Charts page) or pin it again. The pencil opens it for changes or deletion. On the Charts page, the arrows change the order. Make as many as you like.

**Portfolio (its own page, like a broker app).** Shows current value at live prices, amount invested, total profit or loss, and monthly SIPs. Below that is a holdings table with name, units, average cost, invested, latest NAV or price, current value and profit/loss, grouped into mutual funds, stocks & ETFs, deposits and so on. On a phone, units and cost appear under each name. An **Allocation** chart shows how your money is split between mutual funds, stocks & ETFs, deposits, retirement (PPF/EPF, NPS), gold and so on. For **fixed deposits**, add the interest rate, FD start date and maturity date and the app estimates the maturity amount (quarterly compounding, as Indian banks use), shown on the dashboard in the 30 days before maturity.

**Adding a fund or stock.** Click **Add holding**, choose the kind (Mutual fund, Stocks or ETF), and type a few letters in **Find the fund or company**. Pick the right result; the holding takes the official name (e.g. *Parag Parikh Flexi Cap Fund - Direct Plan - Growth*) and the app fetches the latest NAV or price. Then enter:

- **Units you hold** (from your statement or the Groww / Zerodha / fund app), and
- **Average cost per unit** (shown as avg. NAV or avg. price in those apps).

The app fills in the amount invested (units × average cost) and the current value (units × latest price). From then on the value is live. For FDs, PPF, gold and the like, type the current value yourself.

- **Mutual funds:** search and NAVs are free, with nothing to sign up for. NAVs come from MFapi.in, which republishes the official AMFI NAVs several times a day.
- **Stocks and ETFs:** searching companies and live prices needs a free key from alphavantage.co (25 lookups a day). Paste it in **Settings → Stock price key**. Without the key you can still type the company name and enter units and cost; it just won't be live.
- **When prices update:** automatically when you open the app (funds at most every 3 hours, stocks once a day), or with **Refresh prices** on the Portfolio page. You can turn automatic updates off in Settings.
- **How it's recorded:** changes in market value are saved as one *Market value* entry per holding per month. They change your profit and net worth, never your income, spending or amount invested, and are hidden from the dashboard's recent list.

**SIP units are worked out automatically.** On each SIP date the SIP amount goes out of your bank as money spent (shown as *Invested* on the dashboard). The app then adds the units to your holding by itself:

- **Order time:** each SIP has a setting *Units are allotted at the NAV of*: the SIP date, or 1, 2 or 3 working days later. Set it to match how long your platform takes to place the order. The app uses the first NAV published on or after that day, so weekends and market holidays are handled.
- **Units** = SIP amount × (1 − 0.005% stamp duty) ÷ that NAV. The stamp duty deduction can be switched off in Settings, where you can also set the default order time for lump sums and new SIPs.
- **Expense ratio:** add the fund's expense ratio (TER, from its factsheet) on the holding or SIP. A fund's NAV is already published after its expenses, so the app doesn't subtract it again (that would count it twice). Instead it shows what it costs you, e.g. *about ₹1,240 a year*, on the holding and as *Fund costs* on the Portfolio page.
- Until the NAV for the allotment day is out, the instalment counts at its rupee amount and the holding shows *waiting for NAV*.
- **Check or change any time:** the list icon on a holding opens **Units**, a table of every SIP, purchase and withdrawal with its NAV (and date), units, and whether the app (*Auto*) or you (*You*) set them. Click **Change** to type your statement's figures (fill units or NAV; the other is worked out). **Clear units** there lets the app work them out again. The *units* tag on a transaction opens the same editor.
- **Units to confirm:** anything the app can't work out by itself (stocks, funds not linked to a live NAV, or a NAV still missing 3 days after it was due) goes on this list on the Portfolio page and the dashboard, with a badge on the Portfolio menu item.
- Lump sums added with the **+** button, and withdrawals, are handled the same way.

**SIPs.** Click **Add SIP** and fill in:

- **Units are allotted at the NAV of** (order time) and **Expense ratio** (optional): see above.
- **SIP into**: a fund you already hold, or *A fund not added yet*. For a new fund, search for it by name; the SIP and the holding both take the fund's official name. If you already hold units, enter them and the average cost.
- **SIP amount**, **How often** (monthly, weekly or every 3 months) and **Next SIP date**. A monthly SIP keeps that day, e.g. the 1st of every month (even after short months like February).
- **Paid from**: your bank account.
- Optional **yearly step-up %** (raises the amount once a year) and **stop date**.
- **Invest automatically on the SIP date** (ticked by default).

On or after each SIP date, the app records the payment from your bank the moment you open it and marks it for review (see above). Your bank balance goes down like an expense and the fund's value goes up by the same amount, so your net worth stays accurate. If you set the next SIP date in the past, the missed instalments are filled in. Each instalment has a fixed ID, so two devices can never record the same one twice. You can pause a SIP, or use **Invest now** to record one by hand.

By default SIPs also count as *money going out* in the "Where the money went" chart, monthly totals and the 6-month chart (shown as *SIP & investments* / *Invested*). You can switch this off in **Settings → Count SIPs as money going out**.

**Accounts.** Cash, bank accounts, credit cards and investments. Cards show outstanding, EMI-blocked amount, available limit, utilisation, the current statement date and payment due date. Accounts you no longer use can be archived (hidden but kept in history).

**Transactions.** All entries with filters by month, type, account and category, plus text search.

**EMIs & loans.** Card EMIs and loans (home, car, personal, education, other) with principal, interest rate, tenure, EMI amount, EMIs paid, remaining months and remaining principal. **Record payment** records that month's installment as an expense. **Schedule** shows the full month-by-month amortisation table. If you tick *Record each EMI automatically*, the app logs each EMI when you open the app on or after its due date.

**Subscriptions.** Well-known services (Spotify, Netflix, Amazon Prime, YouTube, Apple, Google, Microsoft, JioHotstar, Airtel, Zomato, Swiggy, LinkedIn and many more) get their brand icon or colours automatically from the name you type; others get a coloured tile with their initials. The dashboard has a Subscriptions card with the monthly and yearly total. Recurring payments with weekly, monthly, quarterly, half-yearly or yearly frequency and a linked account or card. Monthly and yearly totals are shown. Can also be recorded automatically.

**Budgets.** A monthly limit per category, with progress bars that turn amber near the limit and red when over.

**Data.** Export and backup tools (next section).

---

### Money health (menu → Money health)

Everything here is worked out from your own data. Features marked **PRO** will be part of Premium in the Play Store app; in this version they are all unlocked.

- **Health score (0–100):** five bars of up to 20 points each: emergency runway (aim 6 months), savings rate (aim 30% of income kept), card usage (aim under 30% of limits), EMIs vs income (aim under 30%), investing (aim 20% of income). Improve the weakest bar first.
- **Emergency runway:** how long your cash and bank money would cover essential costs (rent and bills, EMIs, and your average groceries, transport, health, fuel, insurance, education) if income stopped. **Settings** lets you also count FDs and liquid funds.
- **Fun money:** a guilt-free monthly allowance for the categories you choose. The jar counts down as you spend and shows how much you can spend per day; it refills on the 1st.
- **Cash-flow forecast (PRO):** each bank and cash account's balance from today to month end (or 30 days), using scheduled salary, bills, EMIs and SIPs plus your everyday spending pace, with a warning if an account may go below zero (or a buffer you set).
- **Credit health:** card usage per card and overall against the 30% line, plus **Log my score** to record your CIBIL/Experian score each month and see the trend. The app can't fetch your score itself; you can get a free report each year from each credit bureau.
- **Idle cash (PRO):** flags money that has stayed in a bank account for a month above a set number of months of your spending (3 by default).
- **Lifestyle creep (PRO):** after 6 months of data, compares how your spending on dining, shopping, entertainment, travel and similar grows with how your income grows.
- **Suggestions:** the features talk to each other. For example, if your runway falls under 3 months the app suggests lowering fun money (one tap, never silently); it also flags accounts heading below zero, card usage over 30%, idle cash, goals behind plan, cool-offs that have ended and an unapplied salary-day plan. They appear on Money health and the dashboard; the × hides one for a week.

### Planners (menu → Planners)

Calculators that update as you type or slide. They show assumptions and are estimates, not financial or tax advice.

- **Financial freedom (PRO):** from your age, spending, investments, monthly investing and yearly step-up, expected return, inflation, safe withdrawal rate and future lifestyle, it estimates the age you could be financially independent, with a range for returns 2% better or worse, a chart, and how much sooner investing 20% more would get you there. Add your year of birth in Settings to fill in your age.
- **Loan prepayment (PRO):** pick a loan (or type one) and an extra payment now and/or every month; see interest saved and how much sooner it ends, or the lower EMI if you keep the end date. Also lists your debts highest-interest first.
- **Capital gains (PRO):** for equity funds, stocks and ETFs whose units the app knows, shows gains booked this financial year, how much of the ₹1.25 lakh tax-free long-term limit is left, unbooked long-term gains you could book tax-free ("gain harvesting"), holdings at a loss that could offset gains, and an estimated tax (long-term 12.5% above ₹1.25 lakh, short-term 20%, plus 4% cess). Update `CG_RULES` in app.js if a budget changes these.
- **Regular vs Direct (PRO):** for funds whose name says Regular, the extra yearly cost, the cost over 10 years, the tax and exit load of switching now, and how many months the switch takes to pay for itself.
- **Salary-day plan:** decide once where salary goes (towards goals, moved to savings or investment accounts, reminders). When salary arrives the dashboard offers **Apply plan**. Includes the 50/30/20 rule of thumb.
- **Year in review:** your year in money (money in, spent, invested, kept, net worth change, no-spend days, top category, favourite place, biggest spend, saving wins, goals reached), with **Share**.

### Split a bill, and the cool-off list

- **Split a bill** (People page or dashboard): total, who paid, who shared it (add new people inline), split equally, by amounts or by percentages. If you paid, your share is your expense and everyone else's share is added to what they owe you; if someone else paid, your share is added to what you owe them. Splits are listed on the People page and can be deleted as one.
- **I want to buy this** (dashboard or Goals page): log a tempting purchase instead of buying it. It shows what the money could become if invested (at an assumed 12% a year). After the cool-off (48 hours by default) decide: **Skip it** (a saving win, totalled on the Goals page and in Year in review) or keep it on the wishlist.

New phone notifications: **Fun money left**, **Emergency runway**, **Card usage alert** and **Cool-off ready**.

### Using KOSH on a phone

On a phone the app is laid out for one hand:

- **Bottom bar:** Home, Activity (transactions), a big **+** to add a transaction, Calendar, and **More** for every other page.
- **Add a transaction fast:** the amount box is large and opens the number pad; **Today / Yesterday** buttons set the date; your five most-used categories appear as buttons under the category box; descriptions you've used before are suggested as you type.
- **Transactions are grouped by day** ("Today", "Yesterday", "Mon, 28 Sept") with each day's total. Tap any transaction to edit or delete it.
- **Buttons on lists say what they do** (Record payment, Pause, Edit...) and are big enough to tap easily. Long names wrap instead of being cut off.
- **Portfolio holdings and statement-import rows show as cards** instead of wide tables.
- **Calendar:** swipe left or right to change month.
- Pop-up forms open as sheets from the bottom of the screen; tap outside or the × to close.
- Boxes are sized so iPhone doesn't zoom in when you tap them.
- The cloud icon at the top shows sync status (tap it to sync now); the getting-started card on the dashboard can be hidden with its ×.

### Calendar

Open **Calendar** in the menu (or the *Calendar* link on the dashboard's This month panel). Each day of the month shows what you spent in **red**, income in **green** and money invested in **amber**, and days are shaded darker the more you spent, so heavy days stand out at a glance. A **Week** column on the right totals each week. The switch at the top shows both, only spending or only income.

- Tap any day to see its transactions, with buttons to **add an expense or income on that date** (handy when you forgot to log something).
- Days ahead show what's scheduled, with small icons and amounts: bills and subscriptions, salary and other income due, SIPs, EMIs and credit card due dates. **Coming up this month** lists them under the calendar.
- At the top: total spent and income for the month, average spend per day, and your number of no-spend days. For a future month it shows what's scheduled to go out, income expected, and SIPs instead.
- The biggest spending day of the month is linked below the calendar.

### Description suggestions

Every description you type when adding a transaction is remembered. Next time, start typing and matching descriptions appear under the box: type **b** and *Breakfast* shows up. Ones that start with what you typed come first, then ones with a word starting with it (typing *gif* finds *Birthday gift*); the ones you use most and most recently rank higher. Tap one (or use the arrow keys and Enter) to fill it in; its usual category is filled in too, unless you already picked a category. The **×** next to a suggestion forgets it, handy for typos. Descriptions stay remembered even if you delete the transaction.

### New pages in this version

**Insights.** A report on any month, compared with your own *usual*: the average of the three months before it. For the current month it compares with the days gone so far (fixed costs like rent are not scaled) and projects where spending will end up: spending so far, plus your everyday rate for the days left, plus bills and EMIs still due. Insights include how much of your income you kept, categories well above or below usual, budgets you went over, unusually large expenses (over three times your typical one in that category), where you spend most, new places, weekend vs weekday spending, no-spend days, fixed costs as a share of income, money invested, goals falling behind, home expenses to take back, money you owe, and payments that look regular (with an *Add to Recurring* button). Below them: a category table (this month, usual, difference) and your biggest expenses. The dashboard shows the top three insights.

**Import statement** (also a button on Transactions).

1. **Fill in the last 4 digits of every bank account and card** (Accounts → edit → *Last 4 digits*), e.g. `1234` for your SBI account and `9950` for your credit card. This is how the app knows which account each row belongs to. Cards often appear as `xx50` on PhonePe: the app matches that to your card ending 9950 by itself.
2. Choose the file. **PhonePe:** open PhonePe → *History* → download icon → choose dates → the statement PDF comes by email or in the app. **Banks and cards:** download the statement as **Excel or CSV** where possible (most reliable); PDF also works for many banks.
3. **Money went through:**
   - For a **PhonePe** statement keep **Read it from the statement**: each row goes to the account or card whose number it shows (`…1234` or `xx50`). If a number isn't recognised, that row's account is marked in red: pick it once and the app **remembers that number** from then on.
   - For **one bank's or card's statement** (e.g. HDFC), choose that account: every row goes to it.
4. Choose the **dates to import** (this month, last month, since my last entry, everything). Rows outside the dates are left out.
5. Press **Read statement** (enter the password if the PDF has one), then check each row: account, type, category.
   - **Self transfers:** if the other side of a payment is an account number that's yours (e.g. *Transfer to XXXXXX5678* and 5678 is your HDFC account), the row becomes *Self transfer to HDFC* automatically, so it isn't counted as spending. Money to or from your own name is also suggested as a self transfer when you have one other bank account.
   - **Categories:** the app suggests what you chose before for the same payee (*Remembered*), then what your existing entries use (*From your entries*), then common merchants. "Swiggy", "Swiggy Limited" and "UPI-SWIGGY-swiggy@axb-…" all count as the same payee. Change one row and the other rows for that payee follow.
   - **Already in the app:** rows that match an existing transaction are unticked with *In the app already*. Matching uses the UTR / reference number first (so a PhonePe payment and the same payment in your HDFC statement are recognised as one), then same amount, account and date within 2 days. When a bank statement shows that a matched payment went through a different account than was recorded, tick *Correct its account* to fix it.
6. Press **Import**. With *Remember my choices* ticked (the default), the app saves the type and category for every payee you imported, plus the account for any card or account number. **These memories stay even if you undo the import or delete the transactions**, so you can delete old entries and re-import: your categories come back. Changing a transaction's category later (Transactions → edit) also updates the memory.
7. **Remembered choices** (button on the Import page) lists everything the app has learned, and lets you forget any of it. **Undo last import** removes the latest import's transactions (memories are kept).

**People.** Add Dad, friends and anyone you lend to or borrow from. **I gave** / **I got** record money going either way (lent, paid back, borrowed, got back); each person shows *Owes you* or *You owe*, with a full history. These balances count in net worth (*Owed to me* and *I owe* in the equation).

**Home expenses to take back.** When you add an expense you paid for home, tick **Paid for home: I'll take it back** and choose who pays you back (Dad by default). It stays out of your own spending and appears under **People → Home expenses to take back** (the People menu item shows how many). When you're paid, tick them and **Mark ticked as taken back**: either *money was paid to me* (choose the account it came into) or *adjust against what I owe* (no money moves; handy if you had borrowed from Dad).

**Goals & wishlist.** A goal has a target, an optional date and an icon; *Add money* sets money aside for it (your account balances don't change), and you can count an account towards it (for example an RD kept for that goal). Each goal shows how much to save each month and whether you're on track. The wishlist holds things you want to buy, like a 3D printer, with price and priority; each shows about how many months of your usual leftover it needs. **Start saving** turns an item into a goal; **Mark bought** marks it and opens the expense form with the price filled in.

**Recurring** (was Subscriptions). Three kinds: *subscriptions* (Netflix, Spotify...), *bills* (rent, electricity, maid) and *income* (salary). Tick *Record it automatically* and each logs itself on its date: rent as an expense, salary as income into your bank.

**Tax helper.** A planning estimate for any financial year (April to March) from the income you log: tax under the new regime (default) and the old regime, and which is lower. From 1 April 2026 the Income-tax Act, 2025 applies: the old Section 80C is now Section 123 and 80D is Section 126, with the same limits. Rules used: new regime slabs 0–4L nil, 4–8L 5%, 8–12L 10%, 12–16L 15%, 16–20L 20%, 20–24L 25%, above 30%, no tax up to ₹12 lakh taxable income, ₹75,000 standard deduction for salary; old regime 0–2.5L nil, 2.5–5L 5%, 5–10L 20%, above 30%, ₹50,000 standard deduction; 4% cess. The deductions tracker (old regime only) counts money into PPF/EPF, NPS and funds named ELSS or *tax saver* by itself; add others (LIC, health insurance...) by hand. It's an estimate: surcharge, capital gains, HRA and other exemptions are not included. Check with a CA before filing. If a future budget changes slabs, they're in `TAX_RULES` at the top of that section of `app.js`.

### Notifications on your phone

Open **Notifications** in the menu. You choose what your phone tells you and when (India time):

| Notification | What it says |
|---|---|
| Balances in all accounts | Each bank account and cash, the total, and card dues (investments optional) |
| Yesterday's spending | Yesterday's total by category, against your daily average |
| Log today's expenses | A nudge to log, only if nothing is logged yet (or always) |
| Today's spending so far | An evening look at today |
| Payments coming up | Subscriptions, rent, salary, EMIs, SIPs and card bills due today, tomorrow or in the next 3 or 7 days (silent when nothing is due) |
| Credit card bill due | The amount, a few days before the due date |
| Budget alerts | Categories past a share of their budget, e.g. 80% (silent otherwise) |
| Low balance | Accounts below an amount you choose |
| Large expenses | Yesterday's expenses above an amount |
| This month so far | Spent, where the month is heading, budgets near their limit |
| Weekly summary | Last 7 days vs the week before, top categories |
| Monthly report | Last month's income, spending, investing, how much you kept |
| Net worth, Portfolio value, Goals progress, Money with people, SIP units to confirm | As the names say |
| Your own reminder | Any text, e.g. "Pay the maid" on the 1st |

Each one has a time and a repeat (every day, Monday to Friday, weekends, once a week on a chosen day, or once a month on a chosen date), its own options, a live **preview** with today's data, an on/off switch, **Send now**, and **Hide amounts** (shows ••• instead of rupees). **Add a recommended set** adds a sensible starting group you can edit.

**Setting it up once:**

1. Install the free **ntfy** app (App Store / Play Store) and allow its notifications. On iPhone also keep *Background App Refresh* on for ntfy (Settings → ntfy) so messages arrive on time.
2. On the Notifications page press **Create** to get your private topic, **Copy** it, and in ntfy tap **+** and subscribe to exactly that name (server ntfy.sh).
3. Press **Send a test**.
4. Press **Send schedule to GitHub**. This writes a small scheduled job (`.github/workflows/kosh-reminder.yml`) into your **private data repository**. Your token needs **Repository permissions → Workflows: Read and write** (GitHub → Settings → Developer settings → Fine-grained tokens → your token). After that, every change you make on the Notifications page updates the job by itself (the page shows *Schedule up to date*). Without the permission, the app shows the file so you can add it by hand.

**How the timing works.** GitHub runs scheduled jobs on UTC time and often starts them some minutes late. So the job runs 20 minutes before each of your times, works out the India date and time itself, prepares the message from your latest data, and hands it to ntfy with the exact delivery time; ntfy then delivers it on the minute. Messages are prepared 20 minutes early, so something you log in those 20 minutes may not be reflected. Each run's log (your data repository → *Actions*) starts with the India time it ran, which helps if you ever need to check.

**Privacy.** Messages pass through ntfy.sh. Anyone who knows your topic name could read them, so it's long and random; don't share it, press **Change** to get a new one if you think it leaked, and use *Hide amounts* for notifications you want to keep private.

**Other reminders** (Settings → Reminders): a dashboard reminder after 7 pm if nothing is logged, and a daily **calendar** alert that works on iPhone without any app.

## Part 5 — Exporting to Power BI, Excel or Power Automate

Open **Data** and click **Download all (ZIP)**. Single tables can also be downloaded as individual CSVs. The ZIP contains flat, one-row-per-record CSV files that share ID columns so they join cleanly:

| File | One row per | Key columns |
|---|---|---|
| `accounts.csv` | account | `account_id`, type, current balance; for investments also invested amount, gain, units, latest price and date, scheme code / symbol, FD maturity value |
| `transactions.csv` | transaction | `transaction_id`, `from_account_id`, `to_account_id`, `signed_amount`, `year`, `month`, `units` and `unit_nav` for SIPs |
| `ledger.csv` | movement in or out of one account (a transfer produces two rows) | `account_id`, `amount` (+ in / − out), `affects_balance` |
| `emis.csv` | EMI or loan | `emi_id`, `account_id` |
| `emi_schedule.csv` | EMI installment | `emi_id`, installment number, principal, interest, balance |
| `subscriptions.csv` | subscription | `subscription_id`, `account_id` |
| `goals.csv` / `wishlist.csv` | goal / wishlist item | saved so far, % done, monthly amount needed; price, status |
| `sips.csv` | SIP | `sip_id`, `fund_account_id`, `from_account_id`, amount invested so far |
| `budgets.csv` | budget | `category` |
| `categories.csv` | category | `category`, `kind` |
| `kosh-data.json` | — | complete backup of everything |

A `README.txt` inside the ZIP lists the column meanings and the relationships.

**Power BI quick start.** *Get data → Text/CSV*, load the files, then in *Model view* relate `accounts[account_id]` → `ledger[account_id]`, `accounts[account_id]` → `transactions[from_account_id]` (and an inactive one to `to_account_id`), `emis[emi_id]` → `emi_schedule[emi_id]`. For balance-over-time charts use `ledger.csv` filtered to `affects_balance = TRUE`; running total of `amount` by date gives each account's balance. All CSVs are UTF-8 with a BOM, so Excel opens rupee symbols and Hindi/Marathi text correctly.

**Power Automate.** Because `data.json` lives in GitHub, a flow can read it directly with an HTTP action: `GET https://api.github.com/repos/USERNAME/kosh-data/contents/data.json` with headers `Authorization: Bearer YOUR_TOKEN` and `Accept: application/vnd.github.raw+json`. The response is the JSON itself (arrays `accounts`, `transactions`, `emis`, `subscriptions`, `sips`, `budgets`), ready for *Parse JSON*. Use a separate read-only token for flows (Contents: Read-only).

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
| `buildPortfolio()`, `fdInfo()` | Portfolio value, invested amount, gains, allocation and FD estimates. |
| `refreshPrices()`, `mfSearch()`, `stockSearch()`, `mfLatest()`, `stockLatest()`, `holdingUnits()` | Fund / company search, live NAV and stock prices, units held, and the monthly market-value entry. API addresses are at the top of that section. |
| `koshNotifyEngine()`, `NOTIFY_TYPES`, `notifyWorkflow()`, `syncNotifyWorkflow()` | Phone notifications: the messages (shared by the app's previews and the GitHub job), the kinds you can pick, and the scheduled job. |
| `autoAllotUnits()`, `unitReviews()`, `openReview()`, `openUnitsHistory()` | Automatic SIP units, the Units to confirm list, the units editor and the per-holding units table. |
| `CHART_TYPES`, `CHART_VALUES`, `PERIODS`, `openChartBuilder()`, `colorFor()`, `kLabelsPlugin` | The chart builder, its data sources, shared colours and data labels. To add a new kind of value, add an entry to `CHART_VALUES` with a `build` function. |
| `sipTxn()`, `advanceSip()`, `processAutoPayments()` | SIP instalments and automatic recording of SIPs, EMIs and subscriptions. |
| `runSync()` | The fetch → merge → commit loop. If someone else (another device) committed in between, GitHub answers `409 Conflict`; the app re-downloads and re-applies your changes, retrying up to 4 times. |
| `scheduleSync()` | Batches rapid changes into one commit (waits 700 ms after the last change). |
| `connectAndSync()` | First connection logic, including the "merge or discard" question when both this device and GitHub already have data. |

To point the app at a different repository you don't need to edit code — just change the fields in Settings. Branch and file path can be anything (e.g. `finance/2026.json`); The app creates the file if it doesn't exist.

To change the name in the heading ("Kundan's Finance"), open **Settings → Your name**. To add your own categories, open **Settings → Preferences** and edit the category lists. Currency (INR by default, with Indian lakh/crore grouping) is also chosen there.

---

## Part 7 — Security and privacy notes

- **Your token is stored only in this browser's localStorage.** It's never sent anywhere except `api.github.com`. Anyone who can use your browser profile, or any malicious browser extension, could read it. Don't connect the app on shared or public computers; if you must, use **Settings → Forget token** and **Clear data on this device** afterwards.
- **Keep the data repository private.** The Test connection button warns you if it isn't.
- **Scope the token to one repository** with only *Contents: Read and write*, and give it an expiry date. If you think it has leaked, delete it at GitHub → Settings → Developer settings → Personal access tokens, then create a new one.
- **Price lookups share no personal data.** The app sends only fund scheme codes to MFapi.in and stock symbols (with your key) to Alpha Vantage, never amounts, units or names. The stock price key is saved with your settings in your private data file.
- **Statement files never leave your device.** They're read in the browser; only the transactions you import are saved to your data file.
- **Reminder notifications** go through ntfy.sh, a public service: they contain only short text (no amounts), and your topic name acts as the password, so keep it private.
- The app page has a `noindex` tag so search engines won't list it, but the app repository itself is public. That's fine: it contains only code.

---

## Part 8 — Offline use and limits

- If you lose internet, keep using the app. Changes are queued on the device (the chip shows **Offline** or **N pending**) and pushed automatically when you're back online.
- The **first** time a device opens the app it needs internet to load Tailwind, fonts, icons and charts from their CDNs. The service worker (`sw.js`) then keeps copies, so the app opens offline afterwards. App updates arrive the next time you open it online; no hard refresh needed any more.
- Statement import needs internet the first time to load its PDF or Excel reader.
- If two devices edit while both are offline, both sets of changes are merged when they sync. If both edited the *same* entry, the one that syncs last wins.
- Live prices depend on free third-party services (MFapi.in, Alpha Vantage). They're reliable but not guaranteed; if one is down, values simply stay as they were. NAVs are end-of-day figures and stock prices may be delayed, so treat them as close estimates, not trading prices.
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
| Holding shows "Couldn't reach the price service" | No internet, or MFapi.in / Alpha Vantage is briefly down. Try **Refresh prices** later; values stay as they were. |
| "Daily limit of the free stock price key reached" | The free stock key allows 25 checks a day. Prices refresh again tomorrow. |
| An entry stays in "Units to confirm" | The app couldn't find its NAV or price. Click **Enter units** and type the figures from your fund app or statement email. |
| Holding asks you to enter units | Live value needs the units or shares you hold. Edit the holding (or use **Update value**) and enter them. |
| A row's account is red on import | The statement's number (e.g. xx77) doesn't match any account's *Last 4 digits*. Pick the account once; it's remembered. Or add the last 4 digits to that account. |
| A PhonePe PDF shows no transactions | Make sure it's the *transaction statement* PDF from PhonePe. If it still fails, the layout may differ from the one the app expects; send a screenshot (hide personal details) so the reader can be adjusted. |
| Bank PDF rows look wrong | Download the statement as Excel or CSV instead; you can then fix any column under *Columns*. |
| No notification arrives | Check you subscribed to exactly the same topic in ntfy, press *Send a test*, check the Notifications page says *Schedule up to date*, and look under *Actions* in your data repository to see if the job ran. |
| Notifications arrive late on iPhone | Allow notifications and Background App Refresh for ntfy, and turn off Low Power Mode at those times; iOS can hold messages for sleeping apps. The job's log in *Actions* shows the India time each message was prepared. |
| The installed iPhone app asks for GitHub details again | iPhone keeps home-screen apps separate from Safari; enter them once in the app's Settings. |
| Page looks unstyled | A CDN failed to load (network, ad-blocker or firewall). Refresh, or try another network. |

---

## Part 10 — What changed in this version

**Newest:** Money health (score, runway, cash-flow forecast, fun money, credit health, idle cash, lifestyle creep, suggestions), Planners (financial freedom, loan prepayment, capital gains, Regular vs Direct, salary-day plan, year in review), bill splitting and the cool-off list. Before that: a phone-friendly layout (bottom bar, quick add, day-grouped transactions, labelled buttons, cards instead of wide tables). Before that: a Calendar page with day-by-day spending and income. Before that: description suggestions as you type (remembered descriptions, with their usual category). Before that: custom phone notifications (18 kinds, each with its own time and repeat, previews, hide amounts) delivered at the exact India time; the import now keeps your categories even after you delete transactions.

**Before that:** statement import reads account and card numbers (including short `xx50` card numbers), has a *Read it from the statement* option, turns payments to your own account numbers into self transfers, matches payments across PhonePe and bank statements by UTR (and can correct the account), and remembers your categories and account numbers permanently, including after you delete transactions or edit a category.

**Latest update:** Insights tab and dashboard insights; statement import (PhonePe PDF, bank CSV/Excel/PDF) with date range, duplicate check and learned categories; People (money lent and borrowed) and home expenses to take back; goals and wishlist; recurring bills and income (rent, salary); tax helper (new/old regime estimate, Section 123/80C tracker); installable iPhone/Android app that works offline; daily reminders (dashboard, calendar, phone notifications via ntfy).

**Earlier in this version:**

- New name: **Kundan's Finance** (KOSH: Kundan On Savings Hustle), with a personal greeting.
- Brighter design: peacock-navy sidebar, colourful net-worth banner, coloured tiles and colour-coded due dates.
- New **Portfolio** page with allocation chart and FD maturity estimates.
- **SIPs** with automatic monthly investing, step-up, stop date, pause and "Invest now". Upcoming SIPs appear on the dashboard.
- Monthly figures now split **spent** and **invested**; SIPs count as money going out (can be turned off).
- New `sips.csv` export and investment columns in `accounts.csv`.
- **Portfolio page** laid out like a broker app: units, average cost, invested, latest price, current value and profit/loss per holding.
- **Search by name** when adding a fund, stock or SIP; holdings take the official fund or company name.
- **Units and average cost** entered once, then the value is **live** (mutual funds free; stocks with an optional free key).
- **SIP units added automatically** from the NAV of the allotment day (order time you choose, stamp duty deducted), editable any time; expense ratio shown as a yearly cost.
- **Subscription brand icons** and a Subscriptions card on the dashboard; a new logo (no more rainbow border).
- **Net worth switches** on the dashboard to leave out investments or card dues (can be hidden in Settings).
- **Your own charts:** 18 chart types and 45 kinds of values (including money with me, expenses by category and much more), data labels, filters shown on each chart, and consistent colours you can change; save, pin to the dashboard, unpin, reorder, edit.
- **SIP review:** each SIP goes out as money spent on its date and waits for you to enter the units and NAV within 5 days (badge, list and dashboard reminders, with a suggested NAV).
- Holding form now shows only the fields that fit the kind of investment (FD fields for deposits, NAV search for mutual funds, symbol for stocks).
- Fully compatible with data from the earlier version.

## Part 11 — What was added beyond the original brief

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
