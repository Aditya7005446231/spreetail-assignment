from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from .. import crud, schemas, models

router = APIRouter(
    prefix="/settlements",
    tags=["settlements"]
)

@router.get("/", response_model=List[schemas.Settlement])
def read_settlements(group_id: int, db: Session = Depends(get_db)):
    """
    Returns all logged settlements for a group.
    """
    return crud.get_settlements(db, group_id=group_id)

@router.post("/", response_model=schemas.Settlement)
def create_settlement(settlement: schemas.SettlementCreate, db: Session = Depends(get_db)):
    """
    Manually logs a settlement between two flatmates.
    """
    # Verify group exists
    db_group = crud.get_group(db, group_id=settlement.group_id)
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
        
    # Verify users exist
    payer = crud.get_user(db, user_id=settlement.payer_id)
    payee = crud.get_user(db, user_id=settlement.payee_id)
    if not payer or not payee:
        raise HTTPException(status_code=404, detail="Payer or Payee not found")
        
    return crud.create_settlement(db, settlement_in=settlement)
