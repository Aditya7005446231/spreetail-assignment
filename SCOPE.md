# SCOPE.md - Database Schema & CSV Anomaly Log

This document defines the relational database schema and details the data anomalies detected in the raw `Expenses Export - Expenses Export.csv` file, along with our implemented policies for handling them.

---

## 1. Relational Database Schema

We use **SQLite** as the relational database engine. The schema contains six relational tables designed to capture flatmate accounts, group details, memberships, transactions, splits, and CSV audit items.

### Table Definitions

#### 1. `users`
Tracks individual flatmates or guest users (e.g. Kabir).
* `id` (INTEGER, Primary Key)
* `username` (VARCHAR, Unique, Indexed)
* `email` (VARCHAR, Nullable)
* `password_hash` (VARCHAR, Nullable)

#### 2. `groups`
Represents expense sharing groups.
* `id` (INTEGER, Primary Key)
* `name` (VARCHAR)
* `created_at` (DATETIME, Default UTC now)

#### 3. `group_memberships`
Tracks group membership timelines. Important for validating if an expense happened during a member's active period.
* `id` (INTEGER, Primary Key)
* `group_id` (INTEGER, Foreign Key to `groups.id`)
* `user_id` (INTEGER, Foreign Key to `users.id`)
* `joined_at` (DATE, Not Null)
* `left_at` (DATE, Nullable)

#### 4. `expenses`
Stores details of verified and unverified (staged) expenses.
* `id` (INTEGER, Primary Key)
* `group_id` (INTEGER, Foreign Key to `groups.id`)
* `paid_by_id` (INTEGER, Foreign Key to `users.id`, Nullable for missing payers)
* `amount` (FLOAT, Not Null) - Stored in base currency (INR)
* `currency` (VARCHAR, Not Null) - e.g. "INR" or "USD"
* `description` (VARCHAR)
* `expense_date` (DATE, Not Null)
* `split_type` (VARCHAR, Not Null) - "equal", "unequal", "percentage", "share"
* `notes` (VARCHAR, Nullable)
* `is_verified` (BOOLEAN, Default True) - Set to False if the transaction has pending anomalies
* `original_row_index` (INTEGER, Nullable) - Links back to the CSV row number

#### 5. `expense_splits`
Stores the individual shares owed for each expense.
* `id` (INTEGER, Primary Key)
* `expense_id` (INTEGER, Foreign Key to `expenses.id`)
* `user_id` (INTEGER, Foreign Key to `users.id`)
* `amount_owed` (FLOAT, Not Null)
* `percentage` (FLOAT, Nullable)
* `share` (FLOAT, Nullable)

#### 6. `settlements`
Logs debt-clearing payments between two flatmates.
* `id` (INTEGER, Primary Key)
* `group_id` (INTEGER, Foreign Key to `groups.id`)
* `payer_id` (INTEGER, Foreign Key to `users.id`) - User paying back
* `payee_id` (INTEGER, Foreign Key to `users.id`) - User receiving money
* `amount` (FLOAT, Not Null)
* `currency` (VARCHAR, Default "INR")
* `settlement_date` (DATE, Not Null)
* `is_approved` (BOOLEAN, Default True) - Requires approval if converted from a CSV expense
* `original_row_index` (INTEGER, Nullable)

#### 7. `csv_anomalies`
Audit log of all detected CSV import errors staged for user approval.
* `id` (INTEGER, Primary Key)
* `row_number` (INTEGER)
* `anomaly_type` (VARCHAR) - e.g. "exact_duplicate", "inactive_member_split"
* `description` (VARCHAR)
* `suggested_resolution` (VARCHAR)
* `status` (VARCHAR, Default "pending") - "pending", "resolved"
* `resolved_action` (VARCHAR, Nullable)
* `date_raw` / `description_raw` / `paid_by_raw` / `amount_raw` / `currency_raw` / `split_type_raw` / `split_with_raw` / `split_details_raw` / `notes_raw` (VARCHAR) - Raw data strings from the CSV row

---

## 2. CSV Anomaly Log & Resolution Policies

We detected **16 distinct anomalies** in the spreadsheet export. Our parser flags them and staging inserts them as unverified transactions. Below is the documentation of each anomaly and how our system handles it:

| Row(s) | Column Affected | Description of Anomaly | Implemented Resolution Policy |
| :--- | :--- | :--- | :--- |
| **5 & 6** | *All* | **Exact Duplicate**: Row 5 & 6 are identical Marina Bites dinners by Dev (Rs. 3200) except for description casing. | **Staged Action**: Flagged as `exact_duplicate`. **User Choice**: Delete duplicate row (deletes from database) or keep both. |
| **7** | `amount` | **Number Format (Commas)**: `"1,200"` contains commas and double quotes. | **Staged Action**: Cleaned programmatically via regex/string-replace into float `1200.0` and imported. |
| **9** | `paid_by` | **Lowercase Name**: `priya` is in lowercase. | **Staged Action**: Auto-corrected to canonical `Priya`. |
| **10** | `amount` | **High Precision**: Cylinder refill is `899.995` (3 decimals). | **Staged Action**: Flagged. Rounded to 2 decimals (`900.00`) to prevent fractional paisa round-off errors. |
| **11** | `paid_by` | **Inconsistent Name**: `Priya S` instead of `Priya`. | **Staged Action**: Auto-mapped to canonical `Priya` via similarity dictionary. |
| **13** | `paid_by` | **Missing Payer**: House cleaning supplies (Rs. 780) has an empty payer. | **Staged Action**: Inserted with `paid_by_id = NULL` and marked `is_verified = False`. **User Choice**: Select correct payer from list to activate expense. |
| **14** | `split_type` | **Settlement Logged as Expense**: "Rohan paid Aisha back" (Rs. 5000) lacks a split type and is a repayment. | **Staged Action**: Automatically converted into a `Settlement` record with `is_approved = False`. **User Choice**: Approve conversion to Settlement. |
| **15** | `split_details` | **Percentage Sum Mismatch**: Pizza Friday split totals 110% (30% + 30% + 30% + 20%). | **Staged Action**: Flagged. **User Choice**: Click "Normalize" which adjusts ratios proportionally so they sum to 100% (e.g. 30/110, 20/110) and verifies expense. |
| **20, 21, 23, 26** | `currency` | **Multi-currency (USD)**: Goa villa ($540 USD), Beach shack ($84 USD), Parasailing ($150 USD), Refund (-$30 USD). | **Staged Action**: Converted automatically to INR at historical rate `1 USD = 83.0 INR` and logged currency warnings. |
| **23** | `split_with` | **Guest Split (Non-member)**: Kabir (Dev's friend) is listed in splits, but is not a member of the flatmate group. | **Staged Action**: Created user `Dev's friend Kabir` in the database, computed split including him, and marked it verified. |
| **24 & 25** | *All* | **Conflicting Duplicate**: Aisha logged Thalassa dinner (Rs. 2400), Rohan logged it as Rs. 2450. Notes say Aisha's is wrong. | **Staged Action**: Flagged as `conflicting_duplicate`. **User Choice**: Keep one, delete the other (user deletes Aisha's row 24 and approves Rohan's row 25). |
| **26** | `amount` | **Negative Amount (Refund)**: Parasailing refund of `-30` USD. | **Staged Action**: Flagged as `negative_amount`. Parsed as a refund split, subtracting from split members' totals. |
| **27** | `date`, `paid_by` | **Inconsistent Date/Name Format**: Cab date is `Mar-14` (no year), payer is `rohan` (lowercase). | **Staged Action**: Inferred year 2026 and normalized date to `2026-03-14`. Payer normalized to `Rohan`. |
| **28** | `currency` | **Missing Currency**: Groceries DMart has empty currency. | **Staged Action**: Defaulted to `INR` and flagged `missing_currency` anomaly. |
| **31** | `amount` | **Zero Amount**: Swiggy dinner has `0` amount (counted twice earlier). | **Staged Action**: Flagged as `zero_amount` anomaly. User can skip/ignore. |
| **32** | `split_details` | **Percentage Sum Mismatch**: Brunch split totals 110% (same as Pizza Friday). | **Staged Action**: Flagged. Resolved by normalizing splits to sum to 100%. |
| **36** | `split_with` | **Out-of-Membership Split**: Meera is listed on April 2 groceries, but she moved out in March. | **Staged Action**: Flagged. **User Choice**: Click "Exclude Meera" which removes her from split list and recalculates splits among active members (Aisha, Rohan, Priya). |
| **42** | `split_type` | **Split Detail Mismatch**: Split type says `equal` but specific shares are provided. | **Staged Action**: Flagged. Resolved by applying detail ratios as a custom `share` split. |
