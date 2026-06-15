# Spreetail Split - Shared Expenses App

A relational-database-backed web application built for flatmates to track shared expenses, handle membership timelines, resolve multi-currency conversions, and settle debts with transaction minimization. 

Includes an **Interactive CSV Import Wizard** to detect, stage, and resolve 12+ deliberate data anomalies in raw spreadsheet exports.

---

## 🛠️ Technology Stack

* **Backend**: Python (**FastAPI**) + **SQLAlchemy** (ORM) + **SQLite** (Relational Database)
* **Frontend**: React (**Vite** + JavaScript) + **Vanilla CSS** (Premium glassmorphic theme, dark mode, slide animations)
* **API Communication**: REST JSON endpoints (CORS enabled)

---

## 🚀 Quick Start Guide

You will need **Python 3.8+** and **Node.js 18+** installed.

### 1. Run the Backend API

1. Navigate to the `backend` folder:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start the FastAPI development server:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   * The server runs at `http://localhost:8000`.
   * Open `http://localhost:8000/docs` to access the interactive Swagger API documentation.
   * On startup, the server automatically initializes `shared_expenses.db` and seeds the flatmates group with their respective timelines (Aisha, Rohan, Priya, Meera, Sam, Dev).

### 2. Run the React Frontend

1. Open a new terminal window and navigate to the `frontend` folder:
   ```bash
   cd frontend
   ```
2. Install node dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```
   * Open `http://localhost:5173` in your browser.

---

## 🧪 Running Unit Tests

To verify the CSV parser and anomaly detection scanner logic, run:
```bash
cd backend
python -m unittest test_importer.py
```

---

## 📁 Repository Structure

```
d:\spreetail-assignment\
├── backend\
│   ├── app\
│   │   ├── main.py             # FastAPI App & startup seeding
│   │   ├── database.py         # SQLite connection settings
│   │   ├── models.py           # SQLAlchemy Relational Models
│   │   ├── schemas.py          # Pydantic validation schemas
│   │   ├── importer.py         # CSV Parser and Anomaly detection logic
│   │   ├── crud.py             # Database inserts/queries
│   │   └── routers\            # User, Group, Expense, Settlement, and Import endpoints
│   ├── requirements.txt        # Backend dependencies
│   ├── test_importer.py        # Importer unit tests
│   └── shared_expenses.db      # Local SQLite database file (auto-generated)
├── frontend\
│   ├── src\
│   │   ├── App.jsx             # Main interactive application UI
│   │   ├── index.css           # Premium glassmorphic styles
│   │   └── main.jsx
│   └── package.json            # Node dependencies
├── README.md                   # This document
├── SCOPE.md                    # Database Schema & Anomaly Resolution policies
├── DECISIONS.md                # Decision log & architectural rationale
└── AI_USAGE.md                 # AI collaboration journal
```

---

## 🤖 AI Collaboration

This project was built in collaboration with **Antigravity** (powered by Gemini 3.5 Flash by Google DeepMind) as the primary software engineering collaborator. Detailed AI prompt history and corrections are logged in [AI_USAGE.md](file:///d:/spreetail-assignment/AI_USAGE.md).
