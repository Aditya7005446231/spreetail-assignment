from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Boolean, Date
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    """
    Represents a user (flatmate or guest).
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=True)
    password_hash = Column(String, nullable=True) # For simplicity, login can be passwordless or mocked.

    # Relationships
    memberships = relationship("GroupMembership", back_populates="user")
    expenses_paid = relationship("Expense", back_populates="paid_by")
    splits = relationship("ExpenseSplit", back_populates="user")
    settlements_sent = relationship("Settlement", foreign_keys="Settlement.payer_id", back_populates="payer")
    settlements_received = relationship("Settlement", foreign_keys="Settlement.payee_id", back_populates="payee")


class Group(Base):
    """
    Represents an expense sharing group (e.g., 'Flatmates' or 'Goa Trip').
    """
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    memberships = relationship("GroupMembership", back_populates="group")
    expenses = relationship("Expense", back_populates="group")
    settlements = relationship("Settlement", back_populates="group")


class GroupMembership(Base):
    """
    Tracks group memberships over time, supporting users joining and leaving.
    Required for Sam (joined mid-April) and Meera (left end of March).
    """
    __tablename__ = "group_memberships"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    joined_at = Column(Date, nullable=False)
    left_at = Column(Date, nullable=True) # Null means the user is still a member.

    # Relationships
    group = relationship("Group", back_populates="memberships")
    user = relationship("User", back_populates="memberships")


class Expense(Base):
    """
    Represents a logged expense.
    """
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    paid_by_id = Column(Integer, ForeignKey("users.id"), nullable=True) # Null if payer is unknown (anomaly 5)
    amount = Column(Float, nullable=False)
    currency = Column(String, default="INR", nullable=False) # e.g. "INR", "USD"
    description = Column(String, nullable=False)
    expense_date = Column(Date, nullable=False)
    split_type = Column(String, nullable=False) # "equal", "unequal", "percentage", "share"
    notes = Column(String, nullable=True)
    
    # Audit tracking fields for CSV importing
    is_verified = Column(Boolean, default=True) # False if it needs user approval (e.g. duplicate)
    original_row_index = Column(Integer, nullable=True) # To link back to CSV row

    # Relationships
    group = relationship("Group", back_populates="expenses")
    paid_by = relationship("User", back_populates="expenses_paid")
    splits = relationship("ExpenseSplit", back_populates="expense", cascade="all, delete-orphan")


class ExpenseSplit(Base):
    """
    Tracks how a single expense is divided among group members.
    """
    __tablename__ = "expense_splits"

    id = Column(Integer, primary_key=True, index=True)
    expense_id = Column(Integer, ForeignKey("expenses.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount_owed = Column(Float, nullable=False) # Net amount owed in the expense currency
    percentage = Column(Float, nullable=True)   # If split_type is percentage
    share = Column(Float, nullable=True)        # If split_type is share

    # Relationships
    expense = relationship("Expense", back_populates="splits")
    user = relationship("User", back_populates="splits")


class Settlement(Base):
    """
    Tracks payments made from one user to another to settle balances.
    """
    __tablename__ = "settlements"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    payer_id = Column(Integer, ForeignKey("users.id"), nullable=False) # Who pays
    payee_id = Column(Integer, ForeignKey("users.id"), nullable=False) # Who gets paid
    amount = Column(Float, nullable=False)
    currency = Column(String, default="INR", nullable=False)
    settlement_date = Column(Date, nullable=False)
    is_approved = Column(Boolean, default=True) # Let users approve/verify importing settlements
    original_row_index = Column(Integer, nullable=True)

    # Relationships
    group = relationship("Group", back_populates="settlements")
    payer = relationship("User", foreign_keys=[payer_id], back_populates="settlements_sent")
    payee = relationship("User", foreign_keys=[payee_id], back_populates="settlements_received")


class CsvAnomaly(Base):
    """
    Stores detected data import problems. 
    Users will approve, ignore, or correct these.
    """
    __tablename__ = "csv_anomalies"

    id = Column(Integer, primary_key=True, index=True)
    row_number = Column(Integer, nullable=False)
    date_raw = Column(String, nullable=True)
    description_raw = Column(String, nullable=True)
    paid_by_raw = Column(String, nullable=True)
    amount_raw = Column(String, nullable=True)
    currency_raw = Column(String, nullable=True)
    split_type_raw = Column(String, nullable=True)
    split_with_raw = Column(String, nullable=True)
    split_details_raw = Column(String, nullable=True)
    notes_raw = Column(String, nullable=True)

    anomaly_type = Column(String, nullable=False) # e.g. "duplicate", "missing_currency", "invalid_percentage", "out_of_membership"
    description = Column(String, nullable=False)
    suggested_resolution = Column(String, nullable=True)
    status = Column(String, default="pending") # "pending", "resolved", "ignored"
    resolved_action = Column(String, nullable=True) # Action taken, e.g. "Imported as Refund", "Merged Duplicate"
