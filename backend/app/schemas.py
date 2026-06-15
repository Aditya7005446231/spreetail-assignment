from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import date, datetime

# --- USER SCHEMAS ---
class UserBase(BaseModel):
    username: str

class UserCreate(UserBase):
    email: Optional[str] = None
    password: Optional[str] = None

class User(UserBase):
    id: int

    class Config:
        from_attributes = True

# --- GROUP MEMBERSHIP SCHEMAS ---
class GroupMembershipBase(BaseModel):
    user_id: int
    joined_at: date
    left_at: Optional[date] = None

class GroupMembershipCreate(GroupMembershipBase):
    group_id: int

class GroupMembership(GroupMembershipBase):
    id: int
    group_id: int
    user: User

    class Config:
        from_attributes = True

# --- GROUP SCHEMAS ---
class GroupBase(BaseModel):
    name: str

class GroupCreate(GroupBase):
    pass

class Group(GroupBase):
    id: int
    created_at: datetime
    memberships: List[GroupMembership] = []

    class Config:
        from_attributes = True

# --- EXPENSE SPLIT SCHEMAS ---
class ExpenseSplitBase(BaseModel):
    user_id: int
    amount_owed: float
    percentage: Optional[float] = None
    share: Optional[float] = None

class ExpenseSplitCreate(ExpenseSplitBase):
    pass

class ExpenseSplit(ExpenseSplitBase):
    id: int
    user: User

    class Config:
        from_attributes = True

# --- EXPENSE SCHEMAS ---
class ExpenseBase(BaseModel):
    amount: float
    currency: str
    description: str
    expense_date: date
    split_type: str
    notes: Optional[str] = None

class ExpenseCreate(ExpenseBase):
    paid_by_id: Optional[int] = None
    splits: List[ExpenseSplitCreate] = []

class ExpenseUpdate(BaseModel):
    paid_by_id: Optional[int] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    description: Optional[str] = None
    expense_date: Optional[date] = None
    split_type: Optional[str] = None
    notes: Optional[str] = None
    is_verified: Optional[bool] = None

class Expense(ExpenseBase):
    id: int
    group_id: int
    paid_by_id: Optional[int]
    is_verified: bool
    paid_by: Optional[User] = None
    splits: List[ExpenseSplit] = []

    class Config:
        from_attributes = True

# --- SETTLEMENT SCHEMAS ---
class SettlementBase(BaseModel):
    payer_id: int
    payee_id: int
    amount: float
    currency: str
    settlement_date: date
    is_approved: bool = True

class SettlementCreate(SettlementBase):
    group_id: int

class Settlement(SettlementBase):
    id: int
    group_id: int
    payer: User
    payee: User

    class Config:
        from_attributes = True

# --- CSV ANOMALY SCHEMAS ---
class CsvAnomalyBase(BaseModel):
    row_number: int
    anomaly_type: str
    description: str
    suggested_resolution: Optional[str] = None
    status: str
    resolved_action: Optional[str] = None

class CsvAnomaly(CsvAnomalyBase):
    id: int
    date_raw: Optional[str] = None
    description_raw: Optional[str] = None
    paid_by_raw: Optional[str] = None
    amount_raw: Optional[str] = None
    currency_raw: Optional[str] = None
    split_type_raw: Optional[str] = None
    split_with_raw: Optional[str] = None
    split_details_raw: Optional[str] = None
    notes_raw: Optional[str] = None

    class Config:
        from_attributes = True

# --- REPORT SCHEMAS ---
class ImportReport(BaseModel):
    total_rows: int
    imported_rows: int
    anomalies_found: int
    anomalies: List[CsvAnomaly]

# --- BALANCE SCHEMAS ---
class BalanceSummaryItem(BaseModel):
    user_id: int
    username: str
    paid_amount: float  # Total money they spent
    share_amount: float # Total money they owe
    net_balance: float  # paid - share (positive = is owed, negative = owes)

class SettlementPathItem(BaseModel):
    from_user: User
    to_user: User
    amount: float
    currency: str

class AuditTrailItem(BaseModel):
    expense_id: Optional[int] = None
    settlement_id: Optional[int] = None
    date: date
    type: str # "expense_payment", "expense_share", "settlement_sent", "settlement_received"
    description: str
    original_amount: float
    original_currency: str
    converted_amount: float # in base currency (INR)
    share_ratio: Optional[str] = None # detail for split
    details: str
