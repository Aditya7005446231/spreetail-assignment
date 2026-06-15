# Spreetail Split - Shared Expenses App (Next.js Version)

A relational-database-backed web application built for flatmates to track shared expenses, handle membership timelines, resolve multi-currency conversions, and settle debts with transaction minimization.

Includes an **Interactive CSV Import Wizard** to detect, stage, and resolve 12+ deliberate data anomalies in raw spreadsheet exports.

---

## 🛠️ Technology Stack

* **Framework**: Next.js (App Router, JavaScript)
* **Styling**: Global Vanilla CSS (incorporating a premium dark-theme layout, glassmorphic cards, and custom transitions)
* **Database**: SQLite (using standard `sqlite3` and `sqlite` promise wrapper)
* **API Communication**: Next.js Serverless Route Handlers (CORS-free, hosted on the same origin/port)

---

## 🚀 Quick Start Guide

You will need **Node.js 18+** installed.

### 1. Install Dependencies
Run the install command in the root workspace folder:
```bash
npm install
```

### 2. Start the Development Server
```bash
npm run dev
```
* Open your browser and navigate to **`http://localhost:3000`** to view the app!
* *Note*: On the first load, the database (`shared_expenses.db`) is automatically initialized and seeded with default members (Aisha, Rohan, Priya, Meera, Sam, Dev) and their group membership timelines.

---

## 🧪 Running Unit Tests

To run the JavaScript parser and anomaly checker verification tests, execute:
```bash
node test_importer.mjs
```

---

## 📁 Repository Structure

```
d:\spreetail-assignment\
├── app\
│   ├── api\                    # Next.js Serverless API routes
│   │   ├── users\route.js      # GET/POST users
│   │   ├── groups\route.js     # GET/POST groups
│   │   ├── settlements\route.js# GET/POST manual settlements
│   │   ├── imports\
│   │   │   ├── upload\route.js # POST CSV parser & SQLite staging
│   │   │   └── anomalies\      # GET pending review anomalies
│   │   └── expenses\
│   │       ├── route.js        # GET/POST verified expenses
│   │       ├── balances\       # GET netted group balance summaries
│   │       ├── settlements-path\# GET cash minimized paths (Aisha's guide)
│   │       └── audit\          # GET user audit logs (Rohan's trace)
│   ├── layout.js               # Root layout & page metadata
│   ├── page.js                 # Unified Client dashboard component
│   └── globals.css             # Custom glassmorphic CSS styling
├── lib\
│   ├── db.js                   # Database caching & table seed startup
│   └── importer.js             # CSV parser & anomaly scanning logic
├── public\                     # Static assets
├── README.md                   # Setup instructions (This document)
├── SCOPE.md                    # Database schema & anomaly list details
├── DECISIONS.md                # Architectural design rationale
├── AI_USAGE.md                 # AI pairing log & corrections journal
├── test_importer.mjs           # CSV parser unit test suite
└── package.json                # Project dependencies
```

---

## 🤖 AI Collaboration

This project was rebuilt in Next.js in collaboration with **Antigravity** (powered by Gemini 3.5 Flash by Google DeepMind) as the primary software engineering collaborator. Detailed prompts and design decisions are logged in [AI_USAGE.md](file:///d:/spreetail-assignment/AI_USAGE.md).
