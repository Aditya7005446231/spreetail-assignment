from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from .. import crud, schemas

router = APIRouter(
    prefix="/users",
    tags=["users"]
)

@router.get("/", response_model=List[schemas.User])
def read_users(db: Session = Depends(get_db)):
    """
    Returns all users in the application database.
    """
    return db.query(crud.models.User).all()

@router.post("/", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    """
    Registers a new user profile.
    """
    db_user = crud.get_user_by_username(db, username=user.username)
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    return crud.create_user(db, username=user.username, email=user.email)
