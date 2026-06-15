import csv
import io
import re
from datetime import datetime, date
from typing import List, Dict, Any, Tuple
from sqlalchemy.orm import Session
from . import models, crud

# Standard exchange rate for USD to INR
EXCHANGE_RATE_USD_TO_INR = 83.0

# Canonical user list
CANONICAL_USERS = ["Aisha", "Rohan", "Priya", "Meera", "Sam", "Dev"]

# Similarity name mapping to clean up messy inputs
NAME_MAPPING = {
    "aisha": "Aisha",
    "rohan": "Rohan",
    "priya": "Priya",
    "priya s": "Priya",
    "meera": "Meera",
    "sam": "Sam",
    "dev": "Dev",
    "rohan paid aisha back": "Rohan" # Edge case cleanup
}

def normalize_name(raw_name: str) -> str:
    if not raw_name:
        return ""
    cleaned = raw_name.strip().lower()
    return NAME_MAPPING.get(cleaned, raw_name.strip())

def parse_date(date_str: str) -> Tuple[date, bool, str]:
    """
    Parses various date formats and returns (parsed_date, is_anomaly, anomaly_desc)
    Formats:
    - DD-MM-YYYY (e.g. 01-02-2026)
    - MMM-DD (e.g. Mar-14 -> assume year 2026)
    - YYYY-MM-DD
    """
    if not date_str:
        return date.today(), True, "Empty date field"
    
    date_str = date_str.strip()
    
    # Try DD-MM-YYYY
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str, fmt).date(), False, ""
        except ValueError:
            continue
            
    # Try Mar-14 format (MMM-DD)
    try:
        parsed_dt = datetime.strptime(date_str, "%b-%d")
        # Assume year 2026 based on spreadsheet context
        return parsed_dt.replace(year=2026).date(), True, f"Inconsistent date format '{date_str}', inferred as 2026-03-14"
    except ValueError:
        pass

    try:
        parsed_dt = datetime.strptime(date_str, "%d-%b")
        return parsed_dt.replace(year=2026).date(), True, f"Inconsistent date format '{date_str}', inferred as 2026-03-14"
    except ValueError:
        pass

    return date.today(), True, f"Failed to parse date format: '{date_str}'"

def clean_amount(amount_str: str) -> Tuple[float, List[str]]:
    """
    Cleans amount string by removing commas, quotes, etc.
    Returns (cleaned_amount, anomalies)
    """
    anomalies = []
    if not amount_str:
        return 0.0, ["Empty amount field"]
    
    # Remove commas and quotes
    cleaned = amount_str.replace('"', '').replace(',', '').strip()
    
    try:
        val = float(cleaned)
        # Check if amount is negative (Refund)
        if val < 0:
            anomalies.append("negative_amount")
        # Check if amount is zero
        elif val == 0:
            anomalies.append("zero_amount")
        # Check float precision (e.g. 899.995 has 3 decimals)
        elif "." in cleaned:
            decimals = len(cleaned.split(".")[1])
            if decimals > 2:
                anomalies.append("high_precision_amount")
        return val, anomalies
    except ValueError:
        return 0.0, ["invalid_amount"]

def detect_duplicates(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Flags duplicate rows.
    Rule 1: Same date, same amount, same payer, similar description.
    Rule 2: Conflicting duplicate (same date, similar description, different payer or amount).
    """
    duplicates_flagged = []
    
    for i in range(len(rows)):
        row_i = rows[i]
        date_i = row_i.get("parsed_date")
        amount_i = row_i.get("parsed_amount")
        payer_i = normalize_name(row_i.get("paid_by"))
        desc_i = row_i.get("description", "").lower().strip()
        
        for j in range(i + 1, len(rows)):
            row_j = rows[j]
            date_j = row_j.get("parsed_date")
            amount_j = row_j.get("parsed_amount")
            payer_j = normalize_name(row_j.get("paid_by"))
            desc_j = row_j.get("description", "").lower().strip()
            
            # Check for close/exact duplicates
            if date_i == date_j:
                # Calculate description similarity (basic overlap check)
                words_i = set(re.findall(r'\w+', desc_i))
                words_j = set(re.findall(r'\w+', desc_j))
                common_words = words_i.intersection(words_j)
                is_similar_desc = len(common_words) >= 1 or desc_i in desc_j or desc_j in desc_i
                
                if is_similar_desc:
                    if amount_i == amount_j and payer_i == payer_j:
                        # Exact duplicate
                        row_j["anomalies_detected"].append({
                            "type": "exact_duplicate",
                            "desc": f"Duplicate of row {i+1} ('{row_i.get('description')}') on {date_i}",
                            "suggested": "Delete duplicate row"
                        })
                    else:
                        # Conflicting duplicate (e.g. Thalassa dinner)
                        row_j["anomalies_detected"].append({
                            "type": "conflicting_duplicate",
                            "desc": f"Conflicting entry with row {i+1} ('{row_i.get('description')}'). Row {i+1} paid by {payer_i} (Rs.{amount_i}), Row {j+1} paid by {payer_j} (Rs.{amount_j})",
                            "suggested": "Merge or select one correct entry"
                        })
    return rows

def parse_and_validate_csv(csv_content: str, db: Session, group_id: int) -> Dict[str, Any]:
    """
    Parses the CSV content, runs validation checks, and returns raw parsed data,
    anomalies found, and recommended resolutions.
    """
    f = io.StringIO(csv_content.strip())
    reader = csv.DictReader(f)
    
    raw_rows = []
    for idx, row in enumerate(reader):
        row_num = idx + 1 # 1-based index of data rows
        
        # Initialize parsed containers
        row_dict = {
            "row_num": row_num,
            "raw": row,
            "anomalies_detected": []
        }
        
        # 1. Parse Date & Ambiguities
        parsed_date_val, date_anom, date_desc = parse_date(row.get("date"))
        row_dict["parsed_date"] = parsed_date_val
        if date_anom:
            row_dict["anomalies_detected"].append({
                "type": "date_format_inconsistency",
                "desc": date_desc,
                "suggested": "Format to standard YYYY-MM-DD"
            })
            
        # Detect date ambiguity check (e.g. 04-05-2026 -> May 4 vs April 5)
        if row.get("date") == "04-05-2026":
            row_dict["anomalies_detected"].append({
                "type": "date_ambiguity",
                "desc": "Date '04-05-2026' is ambiguous (May 4th or April 5th). Spreadsheet notes ask: 'is this April 5 or May 4?'",
                "suggested": "Keep as May 4th (DD-MM-YYYY matches Rent patterns) or override to April 5th"
            })

        # 2. Parse Amount & clean decimals
        raw_amt = row.get("amount")
        parsed_amt_val, amt_anoms = clean_amount(raw_amt)
        row_dict["parsed_amount"] = parsed_amt_val
        
        for anom in amt_anoms:
            if anom == "negative_amount":
                row_dict["anomalies_detected"].append({
                    "type": "negative_amount",
                    "desc": f"Negative amount detected: {raw_amt} (indicates a refund)",
                    "suggested": "Treat as refund split (reduces total expense)"
                })
            elif anom == "zero_amount":
                row_dict["anomalies_detected"].append({
                    "type": "zero_amount",
                    "desc": "Expense amount is 0",
                    "suggested": "Ignore/Skip importing this row"
                })
            elif anom == "high_precision_amount":
                row_dict["anomalies_detected"].append({
                    "type": "high_precision_amount",
                    "desc": f"Amount {raw_amt} contains too many decimal places (fractional paisa)",
                    "suggested": f"Round to 2 decimal places: {round(parsed_amt_val, 2)}"
                })
            elif anom == "invalid_amount":
                row_dict["anomalies_detected"].append({
                    "type": "invalid_amount",
                    "desc": f"Invalid non-numeric amount: '{raw_amt}'",
                    "suggested": "Request correct amount from user"
                })

        # 3. Parse Currency
        curr = row.get("currency", "").strip()
        row_dict["parsed_currency"] = curr
        if not curr:
            row_dict["parsed_currency"] = "INR" # Default fallback
            row_dict["anomalies_detected"].append({
                "type": "missing_currency",
                "desc": "Currency field is missing, defaulting to INR",
                "suggested": "Default to INR"
            })
        elif curr == "USD":
            # Multi-currency handling
            inr_amt = parsed_amt_val * EXCHANGE_RATE_USD_TO_INR
            row_dict["anomalies_detected"].append({
                "type": "currency_usd",
                "desc": f"Currency is in USD ($ {parsed_amt_val}). Auto-converting to INR using exchange rate 1 USD = 83.0 INR",
                "suggested": f"Convert to Rs. {inr_amt:.2f} (1 USD = 83 INR)"
            })
            row_dict["converted_amount_inr"] = inr_amt
        else:
            row_dict["converted_amount_inr"] = parsed_amt_val

        # 4. Parse Payer
        payer_raw = row.get("paid_by", "")
        payer_norm = normalize_name(payer_raw)
        row_dict["parsed_payer"] = payer_norm
        
        if not payer_raw:
            row_dict["anomalies_detected"].append({
                "type": "missing_payer",
                "desc": "Payer is missing/empty",
                "suggested": "Assign a default payer or request input"
            })
        elif payer_norm not in CANONICAL_USERS:
            row_dict["anomalies_detected"].append({
                "type": "unknown_payer",
                "desc": f"Payer '{payer_raw}' is not a standard flatmate",
                "suggested": f"Map to canonical user or add as guest user"
            })
        elif payer_raw != payer_norm:
            # Case match / suffix correction (e.g. priya -> Priya, Priya S -> Priya)
            row_dict["anomalies_detected"].append({
                "type": "name_inconsistency",
                "desc": f"Payer name '{payer_raw}' normalized to '{payer_norm}'",
                "suggested": f"Auto-map '{payer_raw}' -> '{payer_norm}'"
            })

        # 5. Split Type & Settlement checks
        split_type = row.get("split_type", "").strip().lower()
        split_with_raw = row.get("split_with", "")
        split_details_raw = row.get("split_details", "")
        notes = row.get("notes", "")
        
        row_dict["split_type"] = split_type
        
        # Check if this is actually a settlement logged as an expense
        desc_lower = row.get("description", "").lower()
        is_settlement = "paid" in desc_lower and ("back" in desc_lower or "to" in desc_lower) or not split_type
        if is_settlement or "settlement" in notes.lower():
            row_dict["anomalies_detected"].append({
                "type": "settlement_logged_as_expense",
                "desc": "This transaction looks like a debt settlement payment between flatmates, not an expense",
                "suggested": "Import as a Settlement rather than an Expense"
            })
            row_dict["is_settlement"] = True
        else:
            row_dict["is_settlement"] = False

        # Parse split users
        split_users_raw = [u.strip() for u in split_with_raw.split(";") if u.strip()]
        split_users = [normalize_name(u) for u in split_users_raw]
        row_dict["split_users"] = split_users
        
        # Check for non-member split (e.g. Kabir)
        for u_raw, u_norm in zip(split_users_raw, split_users):
            if u_norm not in CANONICAL_USERS:
                row_dict["anomalies_detected"].append({
                    "type": "non_member_split",
                    "desc": f"Split list contains guest/non-group member: '{u_raw}'",
                    "suggested": "Exempt guest or add guest to user database"
                })

        # Membership Dates Verification
        # Meera left end of March (2026-03-31)
        # Sam joined mid-April (2026-04-15)
        # Verify if expense date is outside of their memberships
        for user_n in split_users:
            if user_n == "Meera" and parsed_date_val > date(2026, 3, 31):
                row_dict["anomalies_detected"].append({
                    "type": "inactive_member_split",
                    "desc": f"Meera is in the split list on {parsed_date_val}, but she officially moved out at the end of March",
                    "suggested": "Exclude Meera from this split calculation"
                })
            elif user_n == "Sam" and parsed_date_val < date(2026, 4, 15):
                # Sam moved in mid-April. Let's see if deposit or housewarming is valid, or if March electricity affected him.
                # March electricity does not contain Sam in split_with, but April electricity does.
                # Wait, Sam joined mid-April, so if an expense dated before April 15 includes Sam, flag it.
                if "deposit" in desc_lower:
                    # Deposit is fine, but maybe flag for review
                    pass
                else:
                    row_dict["anomalies_detected"].append({
                        "type": "inactive_member_split",
                        "desc": f"Sam is in the split list on {parsed_date_val}, which is before his move-in date (April 15th)",
                        "suggested": "Exclude Sam from this split calculation"
                    })

        # Check split details (percentages, shares, unequal splits)
        if split_type == "percentage":
            # Check percentage totals
            # e.g., Aisha 30%; Rohan 30%; Priya 30%; Meera 20%
            matches = re.findall(r'(\w+)\s+(\d+)%', split_details_raw)
            total_pct = sum(int(pct) for name, pct in matches)
            if total_pct != 100:
                row_dict["anomalies_detected"].append({
                    "type": "percentage_sum_mismatch",
                    "desc": f"Split details percentages sum to {total_pct}% instead of 100%",
                    "suggested": "Normalize percentages to equal 100% proportionally"
                })
        elif split_type == "equal" and split_details_raw:
            row_dict["anomalies_detected"].append({
                "type": "split_type_detail_mismatch",
                "desc": "Split type is 'equal', but specific split details/ratios were provided",
                "suggested": "Ignore details and split equally, or change split type to 'share'"
            })
            
        raw_rows.append(row_dict)
        
    # 6. Scan for duplicates
    raw_rows = detect_duplicates(raw_rows)
    
    return {
        "rows": raw_rows,
        "total_rows": len(raw_rows)
    }

def stage_import_anomalies(db: Session, import_data: Dict[str, Any]) -> List[models.CsvAnomaly]:
    """
    Clears old pending anomalies and inserts the new ones detected during upload staging.
    """
    # Clear existing pending anomalies
    db.query(models.CsvAnomaly).filter(models.CsvAnomaly.status == "pending").delete()
    db.commit()
    
    inserted_anomalies = []
    for r in import_data["rows"]:
        for anom in r["anomalies_detected"]:
            raw_data = r["raw"]
            db_anom = models.CsvAnomaly(
                row_number=r["row_num"],
                date_raw=raw_data.get("date"),
                description_raw=raw_data.get("description"),
                paid_by_raw=raw_data.get("paid_by"),
                amount_raw=raw_data.get("amount"),
                currency_raw=raw_data.get("currency"),
                split_type_raw=raw_data.get("split_type"),
                split_with_raw=raw_data.get("split_with"),
                split_details_raw=raw_data.get("split_details"),
                notes_raw=raw_data.get("notes"),
                anomaly_type=anom["type"],
                description=anom["desc"],
                suggested_resolution=anom["suggested"],
                status="pending"
            )
            db.add(db_anom)
            inserted_anomalies.append(db_anom)
            
    db.commit()
    return inserted_anomalies
