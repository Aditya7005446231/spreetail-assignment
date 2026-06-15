from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from datetime import date
from ..database import get_db
from .. import crud, schemas, models

router = APIRouter(
    prefix="/groups",
    tags=["groups"]
)

@router.get("/", response_model=List[schemas.Group])
def read_groups(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """
    Returns a list of all expense sharing groups.
    """
    return crud.get_groups(db, skip=skip, limit=limit)

@router.post("/", response_model=schemas.Group)
def create_group(group: schemas.GroupCreate, db: Session = Depends(get_db)):
    """
    Creates a new expense sharing group.
    """
    return crud.create_group(db, name=group.name)

@router.get("/{group_id}", response_model=schemas.Group)
def read_group(group_id: int, db: Session = Depends(get_db)):
    """
    Retrieves details for a specific group including memberships.
    """
    db_group = crud.get_group(db, group_id=group_id)
    if db_group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return db_group

@router.post("/{group_id}/members", response_model=schemas.GroupMembership)
def add_group_member(
    group_id: int, 
    membership: schemas.GroupMembershipBase, 
    db: Session = Depends(get_db)
):
    """
    Adds a member to a group, with a specific joined_at and optional left_at date.
    This handles members moving in/out (like Meera leaving or Sam joining).
    """
    db_group = crud.get_group(db, group_id=group_id)
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
        
    db_user = crud.get_user(db, user_id=membership.user_id)
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
        
    # Check if membership already exists
    existing = db.query(models.GroupMembership).filter(
        models.GroupMembership.group_id == group_id,
        models.GroupMembership.user_id == membership.user_id
    ).first()
    
    if existing:
        # Update existing membership dates
        existing.joined_at = membership.joined_at
        existing.left_at = membership.left_at
        db.commit()
        db.refresh(existing)
        return existing
        
    return crud.create_group_membership(
        db, 
        group_id=group_id, 
        user_id=membership.user_id, 
        joined_at=membership.joined_at, 
        left_at=membership.left_at
    )
