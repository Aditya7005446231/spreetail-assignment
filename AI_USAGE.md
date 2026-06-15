# AI_USAGE.md - AI Collaboration Log

This document details the AI tools and prompts used to build the Shared Expenses App, along with three concrete cases where the AI generated incorrect assumptions or configurations, how they were caught, and how we corrected them.

---

## 1. AI Tools & Key Prompts

* **Primary AI Collaborator**: Antigravity (powered by Gemini 3.5 Flash)
* **Key Prompts Used**:
  * "this is my assignment where and how should i start" (Initial prompt sending screenshots of the assignment sheet).
  * "but the thing is i don't know nextjs so how shoucl i use it" (Feedback prompting a change in the tech stack from Next.js to FastAPI + React).
  * "date,description,paid_by,amount,currency... [CSV contents]" (Providing the raw messy CSV spreadsheet export to write parsing rules).

---

## 2. Three Cases of AI Correction

### Case 1: Next.js Tech Stack Misalignment
* **AI's Initial Output**: The AI initially drafted an implementation plan recommending Next.js with React Server Components and SQLite.
* **How it was caught**: The user commented that they did not know Next.js, and their active files in the IDE showed they were working on a Python FastAPI router project elsewhere.
* **How it was corrected**: We refactored the entire project structure and the [implementation_plan.md](file:///C:/Users/Aditya%20Rai/.gemini/antigravity-ide/brain/2afff2dd-14bb-41a0-ad17-f0ab08ecef0d/implementation_plan.md) to use a FastAPI Python backend and a React Vite frontend, which matches the user's skillset and review requirements.

### Case 2: Missing `python-multipart` Dependency
* **AI's Initial Output**: The AI created `requirements.txt` listing only `fastapi`, `uvicorn`, `sqlalchemy`, and `pydantic`.
* **How it was caught**: When writing the `/imports/upload` endpoint, we realized that FastAPI's `UploadFile` utilizes starlette's form parsing, which crashes with a `RuntimeError` at runtime if `python-multipart` is not installed.
* **How it was corrected**: We updated [requirements.txt](file:///d:/spreetail-assignment/backend/requirements.txt) to include `python-multipart>=0.0.9` before running the installation command, preventing runtime failures.

### Case 3: Precise Timeline Calculations (Sam's Move-In)
* **AI's Initial Output**: The AI initially designed a simple month-by-month membership filter (e.g. Sam only owes for expenses in April).
* **How it was caught**: Upon inspecting the CSV data, we saw that Sam is listed in the split list on April 10 for "Housewarming drinks", but his official move-in date was mid-April (April 15). A monthly filter would have silently missed this, and an overly strict date checker would have blocked the housewarming split without alerting the user.
* **How it was corrected**: We implemented precise, day-level date checks (`joined_at <= expense_date <= left_at`) in `importer.py` and flagged any split containing a member outside their active window as an `inactive_member_split` anomaly. This staged the record for manual review, allowing the user to select the appropriate action (either "force split anyway" for the housewarming drinks, or "exclude Sam" for other early April charges).
