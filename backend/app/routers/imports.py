from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Dict, Any
from datetime import date, datetime
import json
from ..database import get_db
from .. import crud, schemas, models, importer

router = APIRouter(
    prefix="/imports",
    tags=["imports"]
)

# Seed data helper
def seed_group_and_members(db: Session) -> models.Group:
    # 1. Ensure Group 1 (Flatmates) exists
    group = db.query(models.Group).filter(models.Group.id == 1).first()
    if not group:
        group = models.Group(id=1, name="Flatmates")
        db.add(group)
        db.commit()
        db.refresh(group)

    # 2. Ensure canonical users exist and have group memberships
    # Aisha, Rohan, Priya, Meera, Sam, Dev
    users_data = [
        {"username": "Aisha", "joined": date(2026, 2, 1), "left": None},
        {"username": "Rohan", "joined": date(2026, 2, 1), "left": None},
        {"username": "Priya", "joined": date(2026, 2, 1), "left": None},
        {"username": "Meera", "joined": date(2026, 2, 1), "left": date(2026, 3, 31)}, # left end of March
        {"username": "Sam", "joined": date(2026, 4, 15), "left": None}, # joined mid-April
        {"username": "Dev", "joined": date(2026, 3, 8), "left": date(2026, 3, 15)} # joined for Goa trip
    ]

    for u in users_data:
        db_user = crud.get_or_create_user(db, u["username"])
        # Check membership
        memb = db.query(models.GroupMembership).filter(
            models.GroupMembership.group_id == group.id,
            models.GroupMembership.user_id == db_user.id
        ).first()
        if not memb:
            crud.create_group_membership(
                db, 
                group_id=group.id, 
                user_id=db_user.id, 
                joined_at=u["joined"], 
                left_at=u["left"]
            )
            
    # Dev's friend Kabir (Guest)
    crud.get_or_create_user(db, "Dev's friend Kabir")

    return group

@router.post("/upload", response_model=schemas.ImportReport)
async def upload_csv(
    file: UploadFile = File(...), 
    clear_existing: bool = True, 
    db: Session = Depends(get_db)
):
    """
    Uploads expenses_export.csv, seeds the Flatmates group, detects anomalies, 
    and stages all rows in the database (unverified if they have anomalies).
    """
    contents = await file.read()
    csv_text = contents.decode("utf-8")
    
    # 1. Seed group & members
    group = seed_group_and_members(db)
    
    # 2. Clear old group transactions if clear_existing is True
    if clear_existing:
        db.query(models.ExpenseSplit).join(models.Expense).filter(models.Expense.group_id == group.id).delete(synchronize_session=False)
        db.query(models.Expense).filter(models.Expense.group_id == group.id).delete()
        db.query(models.Settlement).filter(models.Settlement.group_id == group.id).delete()
        db.query(models.CsvAnomaly).delete()
        db.commit()

    # 3. Parse and run validation rules
    parsed_report = importer.parse_and_validate_csv(csv_text, db, group.id)
    
    # Write anomalies to the CsvAnomaly table for staging
    importer.stage_import_anomalies(db, parsed_report)

    # 4. Stage actual expenses & settlements in DB
    for r in parsed_report["rows"]:
        row_num = r["row_num"]
        anoms = r["anomalies_detected"]
        has_blocking_anoms = len(anoms) > 0
        
        # Check if this row is a settlement
        if r.get("is_settlement", False):
            # Resolve payer and payee
            payer = crud.get_or_create_user(db, r["parsed_payer"])
            
            # Settlement payee is usually the split_with name
            payee_name = r["split_users"][0] if r["split_users"] else "Aisha"
            payee = crud.get_or_create_user(db, payee_name)
            
            # Stage settlement
            settlement_in = schemas.SettlementCreate(
                group_id=group.id,
                payer_id=payer.id,
                payee_id=payee.id,
                amount=r["parsed_amount"],
                currency=r["parsed_currency"] or "INR",
                settlement_date=r["parsed_date"],
                is_approved=not has_blocking_anoms # needs approval if it has anomalies
            )
            # Insert direct settlement
            db_settlement = models.Settlement(
                group_id=settlement_in.group_id,
                payer_id=settlement_in.payer_id,
                payee_id=settlement_in.payee_id,
                amount=settlement_in.amount,
                currency=settlement_in.currency,
                settlement_date=settlement_in.settlement_date,
                is_approved=settlement_in.is_approved,
                original_row_index=row_num
            )
            db.add(db_settlement)
            db.commit()
            
        else:
            # Stage expense
            # Resolve paid_by
            payer_id = None
            if r["parsed_payer"]:
                payer_id = crud.get_or_create_user(db, r["parsed_payer"]).id
                
            amount_val = r["parsed_amount"]
            if r["parsed_currency"] == "USD":
                amount_val = r.get("converted_amount_inr", amount_val * 83.0)

            # Insert expense details
            db_expense = models.Expense(
                group_id=group.id,
                paid_by_id=payer_id,
                amount=amount_val,
                currency="INR", # Store base currency as INR
                description=r["raw"].get("description"),
                expense_date=r["parsed_date"],
                split_type=r["split_type"],
                notes=r["raw"].get("notes"),
                is_verified=not has_blocking_anoms, # Verified immediately if no anomalies
                original_row_index=row_num
            )
            db.add(db_expense)
            db.commit()
            db.refresh(db_expense)

            # Compute splits based on raw values
            # We resolve usernames in split_users
            users_owed = []
            for name in r["split_users"]:
                users_owed.append(crud.get_or_create_user(db, name))
                
            # If split list is empty, split among all current active members at that date
            if not users_owed:
                active_membs = crud.get_active_memberships_at_date(db, group.id, r["parsed_date"])
                users_owed = [m.user for m in active_membs]
                
            num_users = len(users_owed) if users_owed else 1
            
            # Simple equal split logic for staging
            for user_o in users_owed:
                owed_amt = 0.0
                if r["split_type"] == "equal":
                    # Negative values (refunds) are allowed to split negatively
                    owed_amt = amount_val / num_users
                elif r["split_type"] == "percentage":
                    # Parse percentage from raw split_details
                    # e.g., Aisha 30%; Rohan 30%
                    pct_match = re.search(rf"{user_o.username}\s+(\d+)%", r["raw"].get("split_details", ""))
                    if pct_match:
                        pct_val = float(pct_match.group(1))
                        owed_amt = (amount_val * pct_val) / 100.0
                    else:
                        # Fallback to equal if not found
                        owed_amt = amount_val / num_users
                elif r["split_type"] == "share":
                    # Parse shares from details (e.g. Rohan 2; Aisha 1)
                    share_match = re.search(rf"{user_o.username}\s+(\d+)", r["raw"].get("split_details", ""))
                    all_shares = re.findall(r'(\w+)\s+(\d+)', r["raw"].get("split_details", ""))
                    total_shares = sum(int(s[1]) for s in all_shares)
                    
                    if share_match and total_shares > 0:
                        user_shares = float(share_match.group(1))
                        owed_amt = (amount_val * user_shares) / total_shares
                    else:
                        owed_amt = amount_val / num_users
                else:
                    # equal fallback
                    owed_amt = amount_val / num_users

                db_split = models.ExpenseSplit(
                    expense_id=db_expense.id,
                    user_id=user_o.id,
                    amount_owed=round(owed_amt, 2),
                    percentage=None,
                    share=None
                )
                db.add(db_split)
                
            db.commit()

    # Get final pending anomalies from db to return in schema
    anomalies = db.query(models.CsvAnomaly).filter(models.CsvAnomaly.status == "pending").all()
    
    return schemas.ImportReport(
        total_rows=parsed_report["total_rows"],
        imported_rows=parsed_report["total_rows"],
        anomalies_found=len(anomalies),
        anomalies=anomalies
    )

@router.get("/anomalies", response_model=List[schemas.CsvAnomaly])
def get_anomalies(db: Session = Depends(get_db)):
    """
    Returns all staged/pending CSV anomalies.
    """
    return db.query(models.CsvAnomaly).filter(models.CsvAnomaly.status == "pending").order_by(models.CsvAnomaly.row_number).all()

@router.post("/anomalies/{anomaly_id}/resolve")
def resolve_anomaly(anomaly_id: int, resolution: Dict[str, Any], db: Session = Depends(get_db)):
    """
    Resolves an anomaly based on the selected resolution choice.
    For example: 
    - exact_duplicate: {"action": "delete"} or {"action": "keep"}
    - missing_payer: {"action": "set_payer", "user_id": 1}
    - inactive_member_split: {"action": "exclude_user", "username": "Meera"}
    """
    anomaly = db.query(models.CsvAnomaly).filter(models.CsvAnomaly.id == anomaly_id).first()
    if not anomaly:
        raise HTTPException(status_code=404, detail="Anomaly not found")
        
    action = resolution.get("action")
    row_num = anomaly.row_number
    
    # 1. Retrieve the corresponding staged expense or settlement
    staged_expense = db.query(models.Expense).filter(models.Expense.original_row_index == row_num).first()
    staged_settlement = db.query(models.Settlement).filter(models.Settlement.original_row_index == row_num).first()
    
    if not staged_expense and not staged_settlement:
        raise HTTPException(status_code=404, detail=f"No staged transaction found for CSV row {row_num}")
        
    # Handle resolution types
    if anomaly.anomaly_type == "exact_duplicate":
        if action == "delete":
            if staged_expense:
                db.delete(staged_expense)
            if staged_settlement:
                db.delete(staged_settlement)
            anomaly.status = "resolved"
            anomaly.resolved_action = "Deleted duplicate entry"
        elif action == "keep":
            if staged_expense:
                staged_expense.is_verified = True
            if staged_settlement:
                staged_settlement.is_approved = True
            anomaly.status = "resolved"
            anomaly.resolved_action = "Approved duplicate entry"

    elif anomaly.anomaly_type == "conflicting_duplicate":
        if action == "delete":
            if staged_expense:
                db.delete(staged_expense)
            if staged_settlement:
                db.delete(staged_settlement)
            anomaly.status = "resolved"
            anomaly.resolved_action = "Deleted conflicting duplicate entry"
        elif action == "keep":
            if staged_expense:
                staged_expense.is_verified = True
            if staged_settlement:
                staged_settlement.is_approved = True
            anomaly.status = "resolved"
            anomaly.resolved_action = "Approved conflicting duplicate entry"

    elif anomaly.anomaly_type == "missing_payer":
        # Resolve by assigning a user
        u_id = resolution.get("user_id")
        if staged_expense and u_id:
            staged_expense.paid_by_id = u_id
            staged_expense.is_verified = True
            anomaly.status = "resolved"
            anomaly.resolved_action = f"Set payer to User ID {u_id}"

    elif anomaly.anomaly_type == "settlement_logged_as_expense":
        # It has already been staged as a Settlement in upload_csv!
        # So we just delete the duplicate Expense (if we staged both) or approve the Settlement.
        # In upload_csv, we actually staged it *as* a Settlement instead of Expense. 
        # So staged_settlement is present, and staged_expense is absent.
        if staged_settlement:
            staged_settlement.is_approved = True
            anomaly.status = "resolved"
            anomaly.resolved_action = "Approved importing as a Settlement record"

    elif anomaly.anomaly_type == "inactive_member_split":
        # Exclude Meera or Sam from splits and recalculate
        if staged_expense:
            user_to_exclude = resolution.get("exclude_username") # e.g. "Meera"
            if user_to_exclude:
                # Find the user's ID
                u_obj = db.query(models.User).filter(models.User.username == user_to_exclude).first()
                if u_obj:
                    # Remove their split record
                    db.query(models.ExpenseSplit).filter(
                        models.ExpenseSplit.expense_id == staged_expense.id,
                        models.ExpenseSplit.user_id == u_obj.id
                    ).delete()
                    
                    # Recalculate remaining splits equally
                    remaining_splits = db.query(models.ExpenseSplit).filter(
                        models.ExpenseSplit.expense_id == staged_expense.id
                    ).all()
                    
                    if remaining_splits:
                        new_share = staged_expense.amount / len(remaining_splits)
                        for rs in remaining_splits:
                            rs.amount_owed = round(new_share, 2)
                            
                    staged_expense.is_verified = True
                    anomaly.status = "resolved"
                    anomaly.resolved_action = f"Excluded {user_to_exclude} from split and re-divided amount"
            else:
                # Force split anyway
                staged_expense.is_verified = True
                anomaly.status = "resolved"
                anomaly.resolved_action = "Approved splitting with inactive member"

    elif anomaly.anomaly_type == "percentage_sum_mismatch":
        # Recalculate splits proportionally to equal 100%
        if staged_expense:
            # In our DB, we've staged them already. If we decide to resolve, we normalize.
            # Let's say we just normalize the splits proportionally so they sum exactly to total expense amount
            splits = db.query(models.ExpenseSplit).filter(models.ExpenseSplit.expense_id == staged_expense.id).all()
            total_stage_owed = sum(s.amount_owed for s in splits)
            if total_stage_owed > 0:
                for s in splits:
                    s.amount_owed = round((s.amount_owed / total_stage_owed) * staged_expense.amount, 2)
            staged_expense.is_verified = True
            anomaly.status = "resolved"
            anomaly.resolved_action = "Normalized splits proportionally to sum to 100%"

    elif anomaly.anomaly_type == "split_type_detail_mismatch":
        # Change equal to share or ignore details.
        # If we change to share, splits are calculated according to details (which we already did in staging).
        # So we just verify it!
        if staged_expense:
            staged_expense.is_verified = True
            anomaly.status = "resolved"
            anomaly.resolved_action = "Accepted split details (imported as share split)"

    else:
        # Default fallback: just approve
        if staged_expense:
            staged_expense.is_verified = True
        if staged_settlement:
            staged_settlement.is_approved = True
        anomaly.status = "resolved"
        anomaly.resolved_action = f"Approved anomaly type: {anomaly.anomaly_type}"
        
    db.commit()
    return {"status": "success", "message": f"Anomaly resolved: {anomaly.resolved_action}"}
