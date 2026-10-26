// Default data, taken from Monthly_Financial_Planner_Dynamic.xlsx (the baseline workbook)
// and extended with the extra structures the web app needs.

export const SCHEMA_VERSION = 2;

// The 22 expense lines of the "Monthly Budget" sheet. `mid` is the midpoint of the
// suggested % range, used by "Auto-fill from targets".
const CATEGORIES = [
  ['housing', 'Housing (Rent/Mortgage + Insurance + HOA)', 'need', '25-30%', 0.275, 'rent,mortgage,hoa,landlord,apartment,property management,renters insurance,homeowners'],
  ['utilities', 'Utilities (Electric, Gas, Water, Trash)', 'need', '5-10%', 0.06, 'electric,energy,power,gas company,water,sewer,trash,waste,utility,pg&e,con ed,duke energy'],
  ['internet_phone', 'Internet + Phone (basic)', 'need', '2-4%', 0.03, 'comcast,xfinity,spectrum,verizon,at&t,t-mobile,mint mobile,internet,wireless,fiber,cricket,visible'],
  ['groceries', 'Groceries + Household Essentials', 'need', '8-12%', 0.1, 'grocery,supermarket,kroger,safeway,aldi,trader joe,whole foods,publix,heb,wegmans,costco,sam\'s club,walmart,target,food lion,giant,meijer,instacart,produce,milk,bread,eggs,toilet paper,detergent'],
  ['transportation', 'Transportation (Gas, Transit, Parking, Maintenance)', 'need', '8-12%', 0.08, 'shell,exxon,chevron,bp,mobil,sunoco,gas station,fuel,gasoline,uber,lyft,transit,metro,parking,toll,oil change,jiffy lube,autozone,tire,car wash,mta,bart'],
  ['car_payment', 'Car Payment / Lease', 'need', '5-8%', 0.06, 'auto loan,car payment,lease,toyota financial,honda financial,ally auto,capital one auto'],
  ['health', 'Health Insurance + Medical Out-of-Pocket', 'need', '5-10%', 0.06, 'pharmacy,cvs,walgreens,rite aid,doctor,clinic,hospital,dental,dentist,vision,optometrist,copay,urgent care,prescription,rx,health insurance,medical'],
  ['min_debt', 'Minimum Debt Payments', 'need', 'varies', 0, 'minimum payment,credit card payment,student loan,navient,nelnet,mohela,sallie mae'],
  ['childcare', 'Childcare / Dependent Care', 'need', 'varies', 0, 'daycare,childcare,babysitter,nanny,preschool,tuition'],
  ['insurance', 'Life / Disability Insurance', 'need', '1-3%', 0.015, 'life insurance,disability insurance,term life,policygenius,haven life'],
  ['dining', 'Dining Out / Takeout / Coffee', 'want', '3-6%', 0.045, 'restaurant,cafe,coffee,starbucks,dunkin,mcdonald,chipotle,subway,pizza,burger,taco,doordash,grubhub,uber eats,postmates,diner,grill,bar & grill,panera,chick-fil-a,wendy,kfc,sushi,bakery'],
  ['entertainment', 'Entertainment / Streaming / Hobbies', 'want', '2-5%', 0.03, 'netflix,hulu,disney,hbo,max,spotify,apple music,youtube,movie,cinema,amc,theater,concert,ticketmaster,steam,playstation,xbox,nintendo,game,books,barnes'],
  ['subscriptions', 'Subscriptions (non-essential)', 'want', '1-3%', 0.015, 'subscription,membership,prime,patreon,icloud,google one,dropbox,adobe,chatgpt,claude,notion,audible,duolingo'],
  ['shopping', 'Shopping / Clothing / Personal Care', 'want', '2-5%', 0.03, 'amazon,clothing,apparel,shoes,nike,adidas,h&m,zara,uniqlo,old navy,gap,tj maxx,marshalls,ross,sephora,ulta,salon,barber,haircut,cosmetics,best buy,ikea,home depot,lowe'],
  ['fitness', 'Gym / Fitness / Self-care', 'want', '1-2%', 0.015, 'gym,fitness,planet fitness,la fitness,yoga,pilates,peloton,crossfit,spa,massage'],
  ['travel', 'Travel / Fun Money / Gifts (non-sinking)', 'want', '2-5%', 0.03, 'airline,flight,delta,united,american airlines,southwest,hotel,airbnb,marriott,hilton,expedia,booking.com,gift,florist'],
  ['discretionary', 'Alcohol / Tobacco / Discretionary', 'want', '1-3%', 0.015, 'liquor,wine,beer,spirits,tobacco,vape,smoke shop,brewery,lottery'],
  ['emergency_fund', 'Emergency Fund Contribution', 'savings', '5-10%', 0.07, 'emergency fund,transfer to savings'],
  ['retirement', 'Retirement (beyond employer match)', 'savings', '5-15%', 0.08, 'ira,roth,401k,403b,vanguard,fidelity,schwab retirement'],
  ['extra_debt', 'Extra Debt Payments (above minimum)', 'savings', 'varies', 0, 'extra payment,principal payment'],
  ['sinking_funds', 'Sinking Funds Total Monthly', 'savings', '3-8%', 0.05, 'sinking fund'],
  ['investing', 'Other Investing / Goals', 'savings', 'varies', 0, 'brokerage,robinhood,webull,etrade,stock,crypto,coinbase,investment'],
];

const INCOME_SOURCES = [
  ['salary', 'Primary Job / Salary'],
  ['side', 'Side / Freelance'],
  ['partner', 'Partner / Household'],
  ['other_income', 'Other Income'],
  ['other', 'Other'],
];

const SINKING = [
  ['Emergency Fund (3–6 months essentials)', 12000, 3000, 400, 'High', 'Build first'],
  ['Car Maintenance & Repairs', 1800, 450, 120, 'High', ''],
  ['Holiday / Gifts / Birthday', 1500, 300, 100, 'Medium', 'Nov–Dec peak'],
  ['Annual Insurance Premiums', 2400, 800, 160, 'High', 'Divide by 12'],
  ['Vacation / Travel', 2500, 600, 150, 'Medium', ''],
  ['Home / Apartment Maintenance', 1200, 200, 80, 'Medium', ''],
  ['Medical / Dental / Vision Deductible', 1000, 100, 75, 'Medium', ''],
  ['New Phone / Electronics Replacement', 1000, 200, 50, 'Low', ''],
  ['Clothing / Seasonal', 600, 100, 40, 'Low', ''],
  ['Pet Care / Vet Emergency', 800, 150, 50, 'Medium', ''],
  ['Property Tax / HOA (if not escrowed)', 0, 0, 0, 'High', ''],
  ['Other Sinking Fund', 0, 0, 0, 'Low', ''],
];

const DEBTS = [
  ['Credit Card 1', 'credit_card', 3500, 0.229, 90, 150, 'Avalanche first'],
  ['Credit Card 2', 'credit_card', 1200, 0.189, 40, 50, ''],
  ['Student Loan', 'student_loan', 18000, 0.055, 180, 0, ''],
  ['Car Loan', 'auto_loan', 9500, 0.065, 275, 0, ''],
];

// Liabilities are derived from the Debt Tracker so the two can never disagree
// (in the workbook they did: Net Worth listed $0 car loan while the tracker had $9,500).
const ASSETS = [
  ['checking', 'Checking Accounts', 2500, true],
  ['savings', 'Savings / Emergency Fund', 3000, true],
  ['sinking', 'Sinking Funds (total)', 2500, true],
  ['investments', 'Investment / Brokerage', 8000, false],
  ['retirement', 'Retirement Accounts (401k/IRA)', 25000, false],
  ['home_equity', 'Home Equity (est.)', 0, false],
  ['vehicles', 'Vehicle(s) Value', 12000, false],
  ['other_assets', 'Other Assets', 0, false],
];

const GOALS = [
  ['Fully Funded Emergency Fund (6 mo)', 21000, 3000, 400, '2027-06-30', 'In progress — top priority'],
  ['Pay off all Credit Cards', 4700, 0, 200, '2027-02-28', 'High priority'],
  ['Vacation / Travel Fund', 2500, 600, 150, '2027-08-31', ''],
  ['Home Down Payment / Major Purchase', 20000, 1500, 250, '2029-12-31', ''],
];

export const REVIEW_CHECKLIST = [
  ['1. Accounts & Transactions (5–8 min)', [
    'Update all account balances',
    'Categorize uncategorized transactions',
    'Hunt for errors, duplicates, or unused subscriptions',
    'Cancel or renegotiate at least one recurring cost if possible',
  ]],
  ['2. Income & Cash Flow (3 min)', [
    'Confirm all expected income arrived',
    'Decide the job of any unexpected income',
    'Update next month Planned Income if changes are known',
  ]],
  ['3. Budget vs Actual (8–12 min)', [
    'Review every category variance on Monthly Budget',
    'Identify top 2 overspending categories and root causes',
    'Identify under-spending that can be redirected to goals',
    'Update Sinking Funds and Goals progress',
  ]],
  ['4. Debt, Savings & Net Worth (5 min)', [
    'Update Debt Tracker and note interest paid this month',
    'Update Net Worth snapshot',
    'Confirm automated transfers ran',
    'Celebrate any milestone (debt paid, EF month gained, etc.)',
  ]],
  ['5. Next Month Actions (max 3)', [
    'Write 1–3 specific, measurable actions',
    'Adjust next month Planned numbers',
    'Set calendar reminder for next review',
    'Start next month\'s budget (copy this month)',
  ]],
];

let n = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}${(n++).toString(36)}`;

export function createSeed() {
  const data = {
    version: SCHEMA_VERSION,
    settings: {
      name: 'My Household',
      location: 'United States',
      currency: 'USD',
      annualGross: 75000,
      monthlyEssentials: 3500,
      rule: '50/30/20',
      customTargets: { need: 0.5, want: 0.3, savings: 0.2 },
      efTargetMonths: 6,
      employerMatch: false,
      highInterestApr: 0.08,
      weekStartsOn: 0,
      tax: {
        year: 2026,
        filingStatus: 'single',
        stateRate: 0.04,
        localRate: 0,
        ficaExempt: false,
        applyObbbaDeductions: true,
        preTaxPercent: 0,
      },
      schedulePerson: '',
    },
    categories: CATEGORIES.map(([id, name, type, suggested, mid, kw]) => ({
      id, name, type, suggested, mid, keywords: kw.split(',').map((s) => s.trim()).filter(Boolean),
    })),
    incomeSources: INCOME_SOURCES.map(([id, name]) => ({ id, name })),
    budgets: {},
    transactions: [],
    receipts: [],
    rules: [],
    jobs: [],
    shifts: [],
    paystubs: [],
    bills: [],
    sinkingFunds: SINKING.map(([name, target, balance, monthly, priority, notes]) => ({
      id: uid('sf'), name, target, balance, monthly, priority, notes, dueDate: '',
    })),
    debts: DEBTS.map(([name, kind, balance, apr, minPayment, extraPayment, notes]) => ({
      id: uid('debt'), name, kind, balance, apr, minPayment, extraPayment, notes,
    })),
    debtStrategy: { method: 'avalanche', extraMonthly: 200 },
    netWorth: {
      assets: ASSETS.map(([id, name, value, liquid]) => ({ id, name, value, liquid, notes: '' })),
      otherLiabilities: [{ id: 'mortgage', name: 'Mortgage Balance', value: 0, notes: '' }],
      history: [],
    },
    goals: GOALS.map(([name, target, current, monthly, targetDate, notes]) => ({
      id: uid('goal'), name, target, current, monthly, targetDate, notes,
    })),
    reviews: {},
  };
  // Link the workbook's goals to the balances they track.
  const goal = (name) => data.goals.find((g) => g.name.startsWith(name));
  const fund = (name) => data.sinkingFunds.find((f) => f.name.startsWith(name));
  goal('Fully Funded Emergency Fund').link = 'asset:savings';
  Object.assign(goal('Pay off all Credit Cards'), { link: 'debts:credit_card', startBalance: 4700 });
  goal('Vacation / Travel Fund').link = `sinking:${fund('Vacation').id}`;
  return migrate(data);
}

/* ---------- Investments ---------- */
const DEFAULT_ALLOCATION = {
  '401k': { us_stock: 0.6, intl_stock: 0.3, bonds: 0.1, cash: 0, other: 0 },
  roth_401k: { us_stock: 0.6, intl_stock: 0.3, bonds: 0.1, cash: 0, other: 0 },
  trad_ira: { us_stock: 0.6, intl_stock: 0.3, bonds: 0.1, cash: 0, other: 0 },
  roth_ira: { us_stock: 0.6, intl_stock: 0.3, bonds: 0.1, cash: 0, other: 0 },
  hsa: { us_stock: 0.7, intl_stock: 0.2, bonds: 0, cash: 0.1, other: 0 },
  brokerage: { us_stock: 0.8, intl_stock: 0.2, bonds: 0, cash: 0, other: 0 },
  crypto: { us_stock: 0, intl_stock: 0, bonds: 0, cash: 0, other: 1 },
  '529': { us_stock: 0.6, intl_stock: 0.2, bonds: 0.2, cash: 0, other: 0 },
  other: { us_stock: 0, intl_stock: 0, bonds: 0, cash: 0, other: 1 },
};

export function newInvestmentAccount(type = 'brokerage', fields = {}) {
  return {
    id: uid('inv'), name: '', type, balance: 0, monthly: 0,
    employerMatchRate: 0, employerMatchUpTo: 0,
    allocation: { ...(DEFAULT_ALLOCATION[type] || DEFAULT_ALLOCATION.other) },
    updatedAt: '', ...fields,
  };
}

// Upgrades older saved data in place. Safe to run repeatedly.
export function migrate(data) {
  if (!data.investing) {
    data.investing = {
      accounts: [],
      settings: { currentAge: 25, retireAge: 65, expectedReturn: 0.07, inflation: 0.03, withdrawalRate: 0.04, retirementSpending: 0, age50Plus: false, hsaCoverage: 'self' },
      history: [],
    };
    // v1 kept investments as two hand-typed Net Worth rows; they become real accounts.
    const take = (id, type) => {
      const row = data.netWorth?.assets?.find((a) => a.id === id);
      if (!row) return;
      data.investing.accounts.push(newInvestmentAccount(type, { name: row.name, balance: Number(row.value) || 0 }));
      data.netWorth.assets = data.netWorth.assets.filter((a) => a !== row);
    };
    take('retirement', '401k');
    take('investments', 'brokerage');
  }
  data.settings ||= {};
  data.settings.scheduleAliases ||= [];
  // Plan paycheck by paycheck (every 2 weeks) unless the user chooses calendar months.
  data.settings.planning ||= { mode: 'twopay', frequency: 'biweekly', payday: '' };
  // v2: plan two paychecks at a time by default (unless calendar months were chosen).
  if (!data.settings.planning.v) {
    if (data.settings.planning.mode !== 'month') data.settings.planning.mode = 'twopay';
    data.settings.planning.v = 2;
  }
  // Taxes and overtime are manual: jobs without a tax setting take nothing out, and no job
  // calculates overtime unless it opts in.
  for (const job of data.jobs || []) {
    job.tax ||= { mode: 'none', rates: {}, flat: 0 };
    if (job.autoOvertime === undefined) job.autoOvertime = false;
  }
  if (data.settings.tax) { delete data.settings.tax.useStubRates; delete data.settings.tax.stubRates; }
  data.version = SCHEMA_VERSION;
  return data;
}
