from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from datetime import date
from ..database import get_db
from .. import crud, schemas, models

router = APIRouter(
    prefix="/expenses",
    tags=["expenses"]
)

@router.get("/", response_model=List[schemas.Expense])
def read_expenses(group_id: int, verified_only: bool = True, db: Session = Depends(get_db)):
    """
    Returns all expenses for a group, optionally filtering by verification status.
    """
    query = db.query(models.Expense).filter(models.Expense.group_id == group_id)
    if verified_only:
        query = query.filter(models.Expense.is_verified == True)
    return query.order_by(models.Expense.expense_date.desc()).all()

@router.post("/", response_model=schemas.Expense)
def create_expense(expense: schemas.ExpenseCreate, group_id: int, db: Session = Depends(get_db)):
    """
    Creates an expense and calculates the individual splits.
    """
    # Verify group exists
    db_group = crud.get_group(db, group_id=group_id)
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
        
    return crud.create_expense(db, expense_in=expense, group_id=group_id)

@router.delete("/{expense_id}")
def delete_expense(expense_id: int, db: Session = Depends(get_db)):
    """
    Deletes an expense.
    """
    success = crud.delete_expense(db, expense_id=expense_id)
    if not success:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"status": "success", "message": "Expense deleted"}

@router.put("/{expense_id}/verify", response_model=schemas.Expense)
def verify_expense(expense_id: int, is_verified: bool, db: Session = Depends(get_db)):
    """
    Approves or unapproves a staged CSV expense.
    """
    db_expense = crud.update_expense_verification(db, expense_id=expense_id, is_verified=is_verified)
    if not db_expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    return db_expense

# --- BALANCE SHEET & SETTLEMENT ENGINE ---

@router.get("/balances", response_model=List[schemas.BalanceSummaryItem])
def get_balance_summary(group_id: int, db: Session = Depends(get_db)):
    """
    Calculates the net balance of each user in a group:
    Balance = (Expenses Paid + Settlements Sent) - (Expense Shares Owed + Settlements Received)
    """
    # 1. Fetch group users
    memberships = db.query(models.GroupMembership).filter(models.GroupMembership.group_id == group_id).all()
    users = {m.user_id: m.user for m in memberships}
    
    if not users:
        # Check if there are users created
        all_users = db.query(models.User).all()
        users = {u.id: u for u in all_users}
        
    # Initialize balance sheets
    balances = {uid: {"paid": 0.0, "share": 0.0, "settlements_sent": 0.0, "settlements_received": 0.0, "username": u.username} 
                for uid, u in users.items()}
                
    # 2. Add up verified expenses paid by each user
    expenses = db.query(models.Expense).filter(
        models.Expense.group_id == group_id, 
        models.Expense.is_verified == True
    ).all()
    
    for exp in expenses:
        if exp.paid_by_id in balances:
            balances[exp.paid_by_id]["paid"] += exp.amount
            
        # Add up shares owed by each user
        for split in exp.splits:
            if split.user_id in balances:
                balances[split.user_id]["share"] += split.amount_owed

    # 3. Add up approved settlements
    settlements = db.query(models.Settlement).filter(
        models.Settlement.group_id == group_id,
        models.Settlement.is_approved == True
    ).all()
    
    for setl in settlements:
        if setl.payer_id in balances:
            balances[setl.payer_id]["settlements_sent"] += setl.amount
        if setl.payee_id in balances:
            balances[setl.payee_id]["settlements_received"] += setl.amount
            
    # 4. Construct final summary
    result = []
    for uid, data in balances.items():
        net = (data["paid"] + data["settlements_sent"]) - (data["share"] + data["settlements_received"])
        result.append(schemas.BalanceSummaryItem(
            user_id=uid,
            username=data["username"],
            paid_amount=round(data["paid"], 2),
            share_amount=round(data["share"], 2),
            net_balance=round(net, 2)
        ))
        
    return result

@router.get("/settlements-path", response_model=List[schemas.SettlementPathItem])
def get_settlements_path(group_id: int, db: Session = Depends(get_db)):
    """
    Greedy Debt Minimization Algorithm to resolve "Who pays whom and how much" (Aisha's request).
    Calculates the minimum cash transfers required to settle the group.
    """
    # Fetch balances
    balance_list = get_balance_summary(group_id=group_id, db=db)
    
    # Separate into debtors and creditors
    debtors = []  # net_balance < 0
    creditors = [] # net_balance > 0
    
    for item in balance_list:
        user_obj = db.query(models.User).filter(models.User.id == item.user_id).first()
        if not user_obj:
            continue
        if item.net_balance < -0.01:
            debtors.append({"user": user_obj, "balance": item.net_balance})
        elif item.net_balance > 0.01:
            creditors.append({"user": user_obj, "balance": item.net_balance})
            
    # Greedy matching
    paths = []
    
    # Sort debtors ascending (most negative first)
    # Sort creditors descending (most positive first)
    debtors.sort(key=lambda x: x["balance"])
    creditors.sort(key=lambda x: x["balance"], reverse=True)
    
    d_idx = 0
    c_idx = 0
    
    while d_idx < len(debtors) and c_idx < len(creditors):
        debtor = debtors[d_idx]
        creditor = creditors[c_idx]
        
        d_bal = -debtor["balance"]
        c_bal = creditor["balance"]
        
        settle_amt = min(d_bal, c_bal)
        
        if settle_amt > 0.01:
            paths.append(schemas.SettlementPathItem(
                from_user=schemas.User.from_orm(debtor["user"]),
                to_user=schemas.User.from_orm(creditor["user"]),
                amount=round(settle_amt, 2),
                currency="INR"
            ))
            
        # Update balances
        debtor["balance"] += settle_amt
        creditor["balance"] -= settle_amt
        
        # Advance index if fully settled
        if abs(debtor["balance"]) < 0.01:
            d_idx += 1
        if abs(creditor["balance"]) < 0.01:
            c_idx += 1
            
    return paths

@router.get("/audit/{user_id}", response_model=List[schemas.AuditTrailItem])
def get_user_audit_trail(group_id: int, user_id: int, db: Session = Depends(get_db)):
    """
    Rohan's "No Magic Numbers" Traceability feature.
    Returns every verified expense and settlement affecting this user's balance.
    """
    # Verify user exists
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    trail = []
    
    # 1. Fetch expenses paid by this user
    paid_expenses = db.query(models.Expense).filter(
        models.Expense.group_id == group_id,
        models.Expense.paid_by_id == user_id,
        models.Expense.is_verified == True
    ).all()
    
    for exp in paid_expenses:
        trail.append(schemas.AuditTrailItem(
            expense_id=exp.id,
            date=exp.expense_date,
            type="expense_payment",
            description=f"Paid for '{exp.description}'",
            original_amount=exp.amount,
            original_currency=exp.currency,
            converted_amount=exp.amount if exp.currency != "USD" else exp.amount * EXCHANGE_RATE_USD_TO_INR,
            details=f"Payer: You. Split list: {'; '.join([s.user.username for s in exp.splits])}"
        ))

    # 2. Fetch splits owed by this user
    user_splits = db.query(models.ExpenseSplit).join(models.Expense).filter(
        models.Expense.group_id == group_id,
        models.ExpenseSplit.user_id == user_id,
        models.Expense.is_verified == True
    ).all()
    
    for split in user_splits:
        exp = split.expense
        # If the user paid for it, they also split a share. We record both so it mirrors the balance sheet arithmetic
        ratio_desc = ""
        if exp.split_type == "percentage":
            ratio_desc = f" ({split.percentage}%)"
        elif exp.split_type == "share":
            ratio_desc = f" ({split.share} shares)"
            
        payer_name = exp.paid_by.username if exp.paid_by else "Unknown Payer"
        
        trail.append(schemas.AuditTrailItem(
            expense_id=exp.id,
            date=exp.expense_date,
            type="expense_share",
            description=f"Share of '{exp.description}'",
            original_amount=split.amount_owed, # original_amount is in the currency of the expense
            original_currency=exp.currency,
            converted_amount=split.amount_owed if exp.currency != "USD" else split.amount_owed * EXCHANGE_RATE_USD_TO_INR,
            share_ratio=f"{exp.split_type}{ratio_desc}",
            details=f"Paid by: {payer_name}. Total amount: {exp.currency} {exp.amount}."
        ))

    # 3. Settlements sent by this user
    sent_settlements = db.query(models.Settlement).filter(
        models.Settlement.group_id == group_id,
        models.Settlement.payer_id == user_id,
        models.Settlement.is_approved == True
    ).all()
    
    for setl in sent_settlements:
        trail.append(schemas.AuditTrailItem(
            settlement_id=setl.id,
            date=setl.settlement_date,
            type="settlement_sent",
            description=f"Paid back {setl.payee.username} (Settlement)",
            original_amount=setl.amount,
            original_currency=setl.currency,
            converted_amount=setl.amount if setl.currency != "USD" else setl.amount * EXCHANGE_RATE_USD_TO_INR,
            details=f"You directly paid {setl.payee.username} to settle debt."
        ))

    # 4. Settlements received by this user
    rec_settlements = db.query(models.Settlement).filter(
        models.Settlement.group_id == group_id,
        models.Settlement.payee_id == user_id,
        models.Settlement.is_approved == True
    ).all()
    
    for setl in rec_settlements:
        trail.append(schemas.AuditTrailItem(
            settlement_id=setl.id,
            date=setl.settlement_date,
            type="settlement_received",
            description=f"Received payment from {setl.payer.username} (Settlement)",
            original_amount=setl.amount,
            original_currency=setl.currency,
            converted_amount=setl.amount if setl.currency != "USD" else setl.amount * EXCHANGE_RATE_USD_TO_INR,
            details=f"{setl.payer.username} paid you directly to settle debt."
        ))

    # Sort chronological by date, then sort by type to put payments first if same date
    trail.sort(key=lambda x: (x.date, x.type))
    return trail
