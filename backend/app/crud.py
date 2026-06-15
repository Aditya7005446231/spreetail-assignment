from sqlalchemy.orm import Session
from datetime import date, datetime
from typing import List, Optional
from . import models, schemas

# --- USER CRUD ---
def get_user(db: Session, user_id: int) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.id == user_id).first()

def get_user_by_username(db: Session, username: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.username == username).first()

def create_user(db: Session, username: str, email: Optional[str] = None) -> models.User:
    db_user = models.User(username=username, email=email)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def get_or_create_user(db: Session, username: str) -> models.User:
    user = get_user_by_username(db, username)
    if not user:
        user = create_user(db, username)
    return user

# --- GROUP CRUD ---
def get_group(db: Session, group_id: int) -> Optional[models.Group]:
    return db.query(models.Group).filter(models.Group.id == group_id).first()

def get_groups(db: Session, skip: int = 0, limit: int = 100) -> List[models.Group]:
    return db.query(models.Group).offset(skip).limit(limit).all()

def create_group(db: Session, name: str) -> models.Group:
    db_group = models.Group(name=name)
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    return db_group

# --- GROUP MEMBERSHIP CRUD ---
def create_group_membership(
    db: Session, group_id: int, user_id: int, joined_at: date, left_at: Optional[date] = None
) -> models.GroupMembership:
    db_membership = models.GroupMembership(
        group_id=group_id, user_id=user_id, joined_at=joined_at, left_at=left_at
    )
    db.add(db_membership)
    db.commit()
    db.refresh(db_membership)
    return db_membership

def get_active_memberships_at_date(db: Session, group_id: int, ref_date: date) -> List[models.GroupMembership]:
    # A user is active if joined_at <= ref_date AND (left_at is None OR left_at >= ref_date)
    return db.query(models.GroupMembership).filter(
        models.GroupMembership.group_id == group_id,
        models.GroupMembership.joined_at <= ref_date,
        (models.GroupMembership.left_at == None) | (models.GroupMembership.left_at >= ref_date)
    ).all()

# --- EXPENSE CRUD ---
def create_expense(db: Session, expense_in: schemas.ExpenseCreate, group_id: int) -> models.Expense:
    db_expense = models.Expense(
        group_id=group_id,
        paid_by_id=expense_in.paid_by_id,
        amount=expense_in.amount,
        currency=expense_in.currency,
        description=expense_in.description,
        expense_date=expense_in.expense_date,
        split_type=expense_in.split_type,
        notes=expense_in.notes,
        is_verified=True
    )
    db.add(db_expense)
    db.commit()
    db.refresh(db_expense)

    # Create individual splits
    for split in expense_in.splits:
        db_split = models.ExpenseSplit(
            expense_id=db_expense.id,
            user_id=split.user_id,
            amount_owed=split.amount_owed,
            percentage=split.percentage,
            share=split.share
        )
        db.add(db_split)
    
    db.commit()
    db.refresh(db_expense)
    return db_expense

def get_expense(db: Session, expense_id: int) -> Optional[models.Expense]:
    return db.query(models.Expense).filter(models.Expense.id == expense_id).first()

def get_expenses(db: Session, group_id: int, skip: int = 0, limit: int = 100) -> List[models.Expense]:
    return db.query(models.Expense).filter(models.Expense.group_id == group_id).offset(skip).limit(limit).all()

def update_expense_verification(db: Session, expense_id: int, is_verified: bool) -> Optional[models.Expense]:
    db_expense = get_expense(db, expense_id)
    if db_expense:
        db_expense.is_verified = is_verified
        db.commit()
        db.refresh(db_expense)
    return db_expense

def delete_expense(db: Session, expense_id: int) -> bool:
    db_expense = get_expense(db, expense_id)
    if db_expense:
        db.delete(db_expense)
        db.commit()
        return True
    return False

# --- SETTLEMENT CRUD ---
def create_settlement(db: Session, settlement_in: schemas.SettlementCreate) -> models.Settlement:
    db_settlement = models.Settlement(
        group_id=settlement_in.group_id,
        payer_id=settlement_in.payer_id,
        payee_id=settlement_in.payee_id,
        amount=settlement_in.amount,
        currency=settlement_in.currency,
        settlement_date=settlement_in.settlement_date,
        is_approved=settlement_in.is_approved
    )
    db.add(db_settlement)
    db.commit()
    db.refresh(db_settlement)
    return db_settlement

def get_settlement(db: Session, settlement_id: int) -> Optional[models.Settlement]:
    return db.query(models.Settlement).filter(models.Settlement.id == settlement_id).first()

def get_settlements(db: Session, group_id: int) -> List[models.Settlement]:
    return db.query(models.Settlement).filter(models.Settlement.group_id == group_id).all()

# --- ANOMALY CRUD ---
def create_anomaly(db: Session, anomaly_data: dict) -> models.CsvAnomaly:
    db_anomaly = models.CsvAnomaly(**anomaly_data)
    db.add(db_anomaly)
    db.commit()
    db.refresh(db_anomaly)
    return db_anomaly

def get_anomalies(db: Session) -> List[models.CsvAnomaly]:
    return db.query(models.CsvAnomaly).all()

def get_pending_anomalies(db: Session) -> List[models.CsvAnomaly]:
    return db.query(models.CsvAnomaly).filter(models.CsvAnomaly.status == "pending").all()

def update_anomaly_status(db: Session, anomaly_id: int, status: str, action: Optional[str] = None) -> Optional[models.CsvAnomaly]:
    db_anomaly = db.query(models.CsvAnomaly).filter(models.CsvAnomaly.id == anomaly_id).first()
    if db_anomaly:
        db_anomaly.status = status
        if action:
            db_anomaly.resolved_action = action
        db.commit()
        db.refresh(db_anomaly)
    return db_anomaly
