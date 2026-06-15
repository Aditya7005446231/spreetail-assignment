# DECISIONS.md - Design Decisions Log

This document records the design and engineering decisions made during the development of the Shared Expenses App, including options considered and the rationale behind each choice.

---

## 1. Database Choice: SQLite

* **Options Considered**: PostgreSQL, MySQL, SQLite, MongoDB (NoSQL).
* **Decision**: **SQLite**
* **Rationale**:
  * The assignment explicitly mandates using **relational databases only**.
  * SQLite is a fully relational, ACID-compliant database that requires **zero external server setup** (it stores the entire database in a single local file `shared_expenses.db`).
  * Since this project is reviewed and tested locally on an examiner's computer, SQLite offers the lowest barrier to entry. No Docker containers, configuration strings, or database installation are required.

---

## 2. Tech Stack: FastAPI (Python) + React (Vite)

* **Options Considered**: 
  1. Next.js (Unified full-stack React framework).
  2. Python FastAPI (Backend) + React (Frontend).
* **Decision**: **FastAPI + React**
* **Rationale**:
  * The user prefers not to use Next.js due to unfamiliarity, which could impact their ability to explain the code during the 45-minute live review session.
  * Python (FastAPI) provides high performance, automatic Swagger/OpenAPI documentation (`/docs`), and strong type validation with Pydantic. It is lightweight and easy to read.
  * Vite + React provides a standard, responsive, and extremely fast development workflow for the frontend, utilizing clean JSX.

---

## 3. CSV Import Staging Model

* **Options Considered**:
  1. **Strict Importer**: Fail the entire import if any anomaly is found, requiring the user to fix the CSV. (Rejected: Assignment states editing CSV by hand is not allowed).
  2. **In-Memory Staging**: Hold messy rows in the frontend or memory while resolving them. (Rejected: If the browser is refreshed or server restarted, the progress is lost. Also violates relational database design constraints).
  3. **Database Staging (Flagged Rows)**: Import all CSV rows directly into their respective relational tables, but set `is_verified = False` (for expenses) or `is_approved = False` (for settlements) and log the details in a `csv_anomalies` table.
* **Decision**: **Database Staging (Flagged Rows)**
* **Rationale**:
  * Keeps the database as the single source of truth.
  * Allows the user to shut down the app and resume their anomaly reviews later.
  * Simplifies calculations: we calculate the actual flatmate balances by querying only `is_verified = True` expenses, ensuring unverified anomalies don't corrupt the final balances.
  * Satisfies Meera's requirement: "I want to approve anything the app deletes or changes."

---

## 4. Group Membership Timelines

* **Options Considered**:
  1. **Static Members**: Assume a fixed set of flatmates. (Rejected: Sam moved in mid-April and Meera moved out in March. Static splits would charge Sam for March electricity and Meera for April rent).
  2. **Temporal Membership Ranges**: A relational table `group_memberships` that tracks `joined_at` and `left_at` dates for each user.
* **Decision**: **Temporal Membership Ranges**
* **Rationale**:
  * We seed the Flatmates group with historical dates.
  * When splitting expenses, the app matches the expense date against memberships. If a user is inactive, they are excluded from automatic equal splits, or flagged if explicitly named in the CSV split list (e.g. Meera on April 2). This directly solves Sam's and Meera's concerns.

---

## 5. Debt Simplification Algorithm

* **Options Considered**:
  1. **Pairwise Settlements**: Keep all original debts (e.g., Rohan owes Aisha, Aisha owes Priya, Rohan owes Priya). (Rejected: High transaction count).
  2. **Greedy Debt Minimization**: Net the total balance of each person. Sort debtors and creditors, and match the largest debtor with the largest creditor iteratively.
* **Decision**: **Greedy Debt Minimization**
* **Rationale**:
  * Reduces the overall transaction counts to a minimum (at most $N-1$ payments for $N$ members).
  * Fulfills Aisha's request: "I just want one number per person. Who pays whom, how much, done."

---

## 6. Multi-currency Handling

* **Decision**: **Auto-Conversion with Verification**
* **Rationale**:
  * Since 100% of the flatmates' regular expenses are in INR, we convert USD amounts to INR immediately using a fixed rate (`1 USD = 83.0 INR`).
  * We flag the conversion as an anomaly of type `currency_usd`. The user can inspect the original USD amount in the review panel and approve the conversion rate, maintaining full transparency.
