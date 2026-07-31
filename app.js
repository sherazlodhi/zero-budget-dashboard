// --- App State & DOM Elements ---
let state = {
    url: localStorage.getItem('firefly_url') || '',
    token: localStorage.getItem('firefly_token') || '',
    ignoredAccounts: JSON.parse(localStorage.getItem('firefly_ignored_accounts') || '[]'),
    currentDate: new Date() // Start with current month
};

const dom = {
    modal: document.getElementById('settings-modal'),
    form: document.getElementById('settings-form'),
    urlInput: document.getElementById('apiUrl'),
    tokenInput: document.getElementById('apiToken'),
    accountsGroup: document.getElementById('settings-accounts-group'),
    accountsList: document.getElementById('settings-accounts-list'),
    openSettingsBtn: document.getElementById('open-settings'),
    
    monthDisplay: document.getElementById('current-month-display'),
    prevMonthBtn: document.getElementById('prev-month'),
    nextMonthBtn: document.getElementById('next-month'),
    
    accountsContainer: document.getElementById('accounts-container'),
    budgetsContainer: document.getElementById('budgets-container'),
    piggybanksContainer: document.getElementById('piggybanks-container'),
    billsContainer: document.getElementById('bills-container'),
    budgetTotalSpent: document.getElementById('budget-total-spent')
};

// --- Initialization ---
function init() {
    setupEventListeners();
    
    if (!state.url || !state.token) {
        dom.modal.classList.add('active');
    } else {
        updateMonthDisplay();
        fetchAllData();
    }
}

function setupEventListeners() {
    dom.form.addEventListener('submit', (e) => {
        e.preventDefault();
        state.url = dom.urlInput.value.replace(/\/$/, ""); // Remove trailing slash
        state.token = dom.tokenInput.value;
        
        // Save checkbox states
        const checkboxes = dom.accountsList.querySelectorAll('input[type="checkbox"]');
        if (checkboxes.length > 0) {
            state.ignoredAccounts = Array.from(checkboxes)
                .filter(cb => !cb.checked)
                .map(cb => cb.value);
            localStorage.setItem('firefly_ignored_accounts', JSON.stringify(state.ignoredAccounts));
        }

        localStorage.setItem('firefly_url', state.url);
        localStorage.setItem('firefly_token', state.token);
        dom.modal.classList.remove('active');
        updateMonthDisplay();
        fetchAllData();
    });

    dom.openSettingsBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        dom.urlInput.value = state.url;
        dom.tokenInput.value = state.token;
        
        // Fetch and render accounts list for toggling if token exists
        if (state.url && state.token) {
            dom.accountsList.innerHTML = '<div class="loading-spinner" style="margin:0;width:20px;height:20px;"></div>';
            dom.accountsGroup.style.display = 'block';
            const accounts = await apiGet('/api/v1/accounts?type=asset');
            if (accounts) {
                dom.accountsList.innerHTML = accounts.map(acc => `
                    <label>
                        <input type="checkbox" value="${acc.id}" ${!state.ignoredAccounts.includes(acc.id) ? 'checked' : ''}>
                        ${acc.attributes.name}
                    </label>
                `).join('');
            }
        }
        
        dom.modal.classList.add('active');
    });

    dom.prevMonthBtn.addEventListener('click', () => {
        state.currentDate.setMonth(state.currentDate.getMonth() - 1);
        updateMonthDisplay();
        fetchAllData();
    });

    dom.nextMonthBtn.addEventListener('click', () => {
        state.currentDate.setMonth(state.currentDate.getMonth() + 1);
        updateMonthDisplay();
        fetchAllData();
    });
}

function updateMonthDisplay() {
    const options = { month: 'long', year: 'numeric' };
    dom.monthDisplay.textContent = state.currentDate.toLocaleDateString('en-US', options);
}

// --- API Helpers ---
async function apiGet(endpoint) {
    try {
        const response = await fetch(`${state.url}${endpoint}`, {
            headers: {
                'Authorization': `Bearer ${state.token}`,
                'Accept': 'application/json'
            }
        });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const data = await response.json();
        return data.data || [];
    } catch (err) {
        console.error(err);
        return null;
    }
}

// Calculate next bill date based on freq if Firefly API doesn't provide it
function calculateNextDate(startDateStr, freq) {
    if (!startDateStr) return 'Unknown';
    let current = new Date();
    current.setHours(0,0,0,0);
    
    let nextDate = new Date(startDateStr);
    
    let limit = 0; // Prevent infinite loops
    while (nextDate < current && limit < 1000) {
        if (freq === 'monthly') {
            nextDate.setMonth(nextDate.getMonth() + 1);
        } else if (freq === 'yearly') {
            nextDate.setFullYear(nextDate.getFullYear() + 1);
        } else if (freq === 'weekly') {
            nextDate.setDate(nextDate.getDate() + 7);
        } else if (freq === 'daily') {
            nextDate.setDate(nextDate.getDate() + 1);
        } else {
            break; 
        }
        limit++;
    }
    return nextDate;
}

// --- Data Fetching & Rendering ---
async function fetchAllData() {
    // Show loaders
    const loader = '<div class="loading-spinner"></div>';
    dom.accountsContainer.innerHTML = loader;
    dom.budgetsContainer.innerHTML = loader;
    dom.piggybanksContainer.innerHTML = loader;
    dom.billsContainer.innerHTML = loader;

    // Date formatting for limits
    const year = state.currentDate.getFullYear();
    const month = String(state.currentDate.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(year, state.currentDate.getMonth() + 1, 0).getDate();
    const startStr = `${year}-${month}-01`;
    const endStr = `${year}-${month}-${lastDay}`;

    // Parallel fetching
    const [allAccounts, piggyBanks, budgets, bills] = await Promise.all([
        apiGet('/api/v1/accounts?type=asset'),
        apiGet('/api/v1/piggy-banks'),
        apiGet('/api/v1/budgets'),
        apiGet('/api/v1/bills')
    ]);

    if (!allAccounts || !budgets) {
        dom.accountsContainer.innerHTML = '<p class="error-text">Failed to connect to Firefly III. Check your settings.</p>';
        return;
    }
    
    // Filter accounts based on user settings
    const accounts = allAccounts.filter(acc => !state.ignoredAccounts.includes(acc.id));

    /* Added helper to format amounts in Red if negative */
    const formatNegative = (num, suffix = '') => {
        const valStr = num.toLocaleString() + (suffix ? ' ' + suffix : '');
        return num < 0 ? `<span style="color: var(--accent-rose);">${valStr}</span>` : valStr;
    };

    // 1. Process Piggy Banks
    let totalPiggyBanks = 0;
    let piggyBanksHtml = `
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Goal Name</th>
                        <th class="num">Saved</th>
                        <th class="num">Target</th>
                        <th class="num">%</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    piggyBanks.forEach(pb => {
        const attr = pb.attributes;
        const current = parseFloat(attr.current_amount || 0);
        const target = parseFloat(attr.target_amount || 0);
        totalPiggyBanks += current;
        
        const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
        let pctColor = pct >= 100 ? 'var(--accent-emerald)' : 'var(--text-main)';
        
        piggyBanksHtml += `
            <tr>
                <td>${attr.name}</td>
                <td class="num" style="color: var(--accent-cyan);">${current.toLocaleString()}</td>
                <td class="num">${target > 0 ? target.toLocaleString() : '-'}</td>
                <td class="num" style="color: ${pctColor};">${pct.toFixed(1)}%</td>
            </tr>
        `;
    });
    
    piggyBanksHtml += `</tbody></table></div>`;
    
    if (piggyBanks.length === 0) piggyBanksHtml = '<p class="empty-text">No active piggy banks.</p>';
    dom.piggybanksContainer.innerHTML = piggyBanksHtml;

    // 2. Process Budgets
    let totalRemainingBudgets = 0;
    let totalSpentBudgets = 0;
    let totalLimit = 0;
    let mainCurrency = 'AED';
    
    // Fetch limits for all budgets
    const budgetPromises = budgets.map(b => apiGet(`/api/v1/budgets/${b.id}/limits?start=${startStr}&end=${endStr}`));
    const limitsResults = await Promise.all(budgetPromises);
    
    let budgetHtml = `
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Category</th>
                        <th class="num">Spent</th>
                        <th class="num">Limit</th>
                        <th class="num">Remaining</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    budgets.forEach((b, index) => {
        const attr = b.attributes;
        const limitsData = limitsResults[index];
        mainCurrency = attr.currency_symbol || 'AED';
        
        let limit = 0;
        let spent = 0;
        
        if (limitsData && limitsData.length > 0) {
            const lAttr = limitsData[0].attributes;
            limit = parseFloat(lAttr.amount || 0);
            if (lAttr.spent && lAttr.spent.length > 0) {
                spent = Math.abs(parseFloat(lAttr.spent[0].sum || 0)); // Convert to positive
            }
        }
        
        // Skip rendering this budget entirely if it has no limit and no spending for the selected month
        if (limit === 0 && spent === 0) return;
        
        totalLimit += limit;
        
        const remaining = limit - spent;
        if (remaining > 0) {
            totalRemainingBudgets += remaining;
        }
        totalSpentBudgets += spent;
        
        let statusColor = (remaining < 0 || limit < 0) ? 'var(--accent-rose)' : 'var(--text-main)';

        // Create a Firefly III Search URL so the web UI perfectly filters the expenses by this exact month
        const searchQuery = `budget_is:${attr.name} after:${startStr} before:${endStr}`;
        const encodedQuery = encodeURIComponent(searchQuery).replace(/%20/g, '+');
        const fireflyUrl = `${state.url}/search?search=${encodedQuery}`;

        budgetHtml += `
            <tr>
                <td><a href="${fireflyUrl}" target="_blank" style="color: var(--accent-cyan); text-decoration: none; font-weight: 500; transition: color 0.2s;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${attr.name}</a></td>
                <td class="num">${formatNegative(spent)}</td>
                <td class="num">${formatNegative(limit, mainCurrency)}</td>
                <td class="num" style="color: ${statusColor}; font-weight: 600;">${formatNegative(remaining)}</td>
            </tr>
        `;
    });
    
    const trueTotalRemaining = totalLimit - totalSpentBudgets;
    const trueTotalColor = trueTotalRemaining < 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)';
    
    budgetHtml += `
            <tr style="background: rgba(255,255,255,0.05); border-top: 2px solid rgba(255,255,255,0.1);">
                <td style="font-weight: 700; color: var(--text-main);">Totals</td>
                <td class="num" style="font-weight: 700;">${formatNegative(totalSpentBudgets)}</td>
                <td class="num" style="font-weight: 700;">${formatNegative(totalLimit, mainCurrency)}</td>
                <td class="num" style="color: ${trueTotalColor}; font-weight: 700;">${formatNegative(trueTotalRemaining)}</td>
            </tr>
    </tbody></table></div>`;
    
    if (budgets.length === 0) budgetHtml = '<p class="empty-text">No budgets set.</p>';
    dom.budgetsContainer.innerHTML = budgetHtml;
    dom.budgetTotalSpent.textContent = `${totalSpentBudgets.toLocaleString()} ${mainCurrency} Spent`;

    // 3. Process Accounts & Safe to Spend
    let accountsHtml = `
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Account</th>
                        <th class="num">Balance</th>
                        <th class="num">Savings</th>
                        <th class="num">Available</th>
                    </tr>
                </thead>
                <tbody>
    `;
    let globalAvailableAssets = 0;
    
    // Group piggy banks by account
    let piggyBanksByAccount = {};
    let unlinkedPiggyBanksTotal = 0;
    
    piggyBanks.forEach(pb => {
        const accountsArray = pb.attributes.accounts || [];
        if (accountsArray.length > 0) {
            accountsArray.forEach(acc => {
                const accId = String(acc.account_id);
                const current = parseFloat(acc.current_amount || 0);
                piggyBanksByAccount[accId] = (piggyBanksByAccount[accId] || 0) + current;
            });
        } else {
            const currentGlobal = parseFloat(pb.attributes.current_amount || 0);
            unlinkedPiggyBanksTotal += currentGlobal;
        }
    });

    accounts.forEach(acc => {
        const attr = acc.attributes;
        const balance = parseFloat(attr.current_balance || 0);
        const linkedPiggyBankTotal = piggyBanksByAccount[acc.id] || 0;
        const availableBalance = balance - linkedPiggyBankTotal;
        
        globalAvailableAssets += availableBalance;
        
        accountsHtml += `
            <tr>
                <td>${attr.name}</td>
                <td class="num" style="color: var(--text-muted);">${formatNegative(balance)}</td>
                <td class="num" style="color: var(--accent-rose);">${linkedPiggyBankTotal > 0 ? '-' + linkedPiggyBankTotal.toLocaleString() : '-'}</td>
                <td class="num" style="color: var(--accent-emerald); font-weight: 600;">${formatNegative(availableBalance, attr.currency_symbol)}</td>
            </tr>
        `;
    });
    
    if (unlinkedPiggyBanksTotal > 0) {
        accountsHtml += `
            <tr style="background: rgba(244, 63, 94, 0.05);">
                <td style="color: var(--accent-rose);">Unlinked Savings (Warning)</td>
                <td class="num">-</td>
                <td class="num" style="color: var(--accent-rose);">- ${unlinkedPiggyBanksTotal.toLocaleString()}</td>
                <td class="num" style="color: var(--accent-rose); font-weight: 600;">- ${formatNegative(unlinkedPiggyBanksTotal, mainCurrency)}</td>
            </tr>
        `;
    }
    
    accountsHtml += `</tbody></table></div>`;
    
    globalAvailableAssets -= unlinkedPiggyBanksTotal;

    // --- ZERO-BASED BUDGETING MATH ---
    // Safe to Spend = (Total Assets - All Piggy Banks) - Total Remaining in Positive Budgets
    const safeToSpend = globalAvailableAssets - totalRemainingBudgets;
    const safeColor = safeToSpend < 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)';
    
    // Prepend a master "Safe to Spend" summary card to accounts
    const safeHtml = `
        <div style="font-size: 0.95rem; margin-bottom: 0.8rem; color: var(--text-main);">
            <div>Master Global Safe to Spend: <span style="color: ${safeColor}; font-weight: 700; margin-left: 0.2rem; font-variant-numeric: tabular-nums;">${formatNegative(safeToSpend, mainCurrency)}</span></div>
            <div style="color: var(--text-muted); margin-top: 0.2rem; font-size: 0.75rem; opacity: 0.8;">(${globalAvailableAssets.toLocaleString()} Assets - ${totalRemainingBudgets.toLocaleString()} Budgets)</div>
        </div>
    `;
    
    dom.accountsContainer.innerHTML = safeHtml + accountsHtml;

    // 4. Process Upcoming Bills & Credit Cards
    let upcomingItems = [];
    let today = new Date();
    today.setHours(0,0,0,0);

    // Add standard bills
    bills.forEach(b => {
        const attr = b.attributes;
        if (attr.active === false) return;
        
        let dateObj = null;
        if (attr.next_expected_match) {
            dateObj = new Date(attr.next_expected_match);
        } else if (attr.date && attr.repeat_freq) {
            dateObj = calculateNextDate(attr.date, attr.repeat_freq);
        }
        
        if (dateObj) {
            // Project yearly/monthly bills forward if they are somehow in the past
            while (dateObj < today) {
                if (attr.repeat_freq === 'monthly') dateObj.setMonth(dateObj.getMonth() + 1);
                else if (attr.repeat_freq === 'yearly') dateObj.setFullYear(dateObj.getFullYear() + 1);
                else if (attr.repeat_freq === 'weekly') dateObj.setDate(dateObj.getDate() + 7);
                else break;
            }
            
            if (dateObj >= today) {
                upcomingItems.push({
                    name: attr.name,
                    amount: parseFloat(attr.amount_avg || attr.amount_max || 0),
                    currency: attr.currency_symbol || 'AED',
                    dateObj: dateObj,
                    url: `${state.url}/bills/show/${b.id}`
                });
            }
        }
    });

    // Add Credit Card Due Dates dynamically
    accounts.forEach(a => {
        const attr = a.attributes;
        if (attr.account_role === 'ccAsset') {
            const bal = parseFloat(attr.current_balance || 0);
            if (bal < 0) {
                // Strategy 1: Use monthly_payment_date if Firefly ever fixes their API bug
                let dueDay = null;
                if (attr.monthly_payment_date) {
                    dueDay = new Date(attr.monthly_payment_date).getDate();
                }
                
                // Strategy 2: Parse from Notes field (e.g. "Due: 15")
                if (dueDay === null && attr.notes) {
                    const match = attr.notes.match(/due:\s*(\d+)/i);
                    if (match) dueDay = parseInt(match[1]);
                }
                
                // Strategy 3: Default to day 1 (all cards are due on the 1st)
                if (dueDay === null) dueDay = 1;
                
                let ccDate = new Date();
                ccDate.setHours(0,0,0,0);
                ccDate.setDate(dueDay);
                
                // Project CC date to next upcoming occurrence if it has already passed
                while (ccDate < today) {
                    ccDate.setMonth(ccDate.getMonth() + 1);
                }
                
                upcomingItems.push({
                    name: attr.name + ' Bill',
                    amount: Math.abs(bal),
                    currency: attr.currency_symbol || 'AED',
                    dateObj: ccDate,
                    url: `${state.url}/accounts/show/${a.id}`
                });
            }
        }
    });

    // Sort all upcoming items chronologically
    upcomingItems.sort((a, b) => a.dateObj - b.dateObj);

    // Render the sorted items
    let billsHtml = `<div class="table-container"><table class="data-table">
        <thead><tr><th>Upcoming</th><th class="num">Amount</th><th class="num">Due Date</th></tr></thead><tbody>`;

    if (upcomingItems.length === 0) {
        billsHtml += `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No upcoming bills</td></tr>`;
    } else {
        upcomingItems.forEach(item => {
            const dateStr = item.dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            billsHtml += `
                <tr>
                    <td><a href="${item.url}" target="_blank" style="color: var(--text-main); text-decoration: none; font-weight: 500;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${item.name}</a></td>
                    <td class="num">${item.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${item.currency}</td>
                    <td class="num" style="color: var(--accent-violet);">${dateStr}</td>
                </tr>
            `;
        });

        // Total row
        const totalBills = upcomingItems.reduce((sum, item) => sum + item.amount, 0);
        billsHtml += `
            <tr style="border-top: 2px solid rgba(255,255,255,0.1);">
                <td style="font-weight: 700; color: var(--text-main);">Total Due</td>
                <td class="num" style="font-weight: 700; color: var(--accent-rose);">${totalBills.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} AED</td>
                <td></td>
            </tr>
        `;

        // Update the header badge
        const billsTotalEl = document.getElementById('bills-total');
        if (billsTotalEl) billsTotalEl.textContent = `${totalBills.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} AED Due`;
    }
    
    billsHtml += `</tbody></table></div>`;
    dom.billsContainer.innerHTML = billsHtml;
}

// Start app
document.addEventListener('DOMContentLoaded', init);
