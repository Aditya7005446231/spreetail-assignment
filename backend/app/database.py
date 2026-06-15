import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Support database URLs from environments like Supabase or Neon (PostgreSQL)
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./shared_expenses.db")

# Convert legacy postgres:// to postgresql:// (required by newer SQLAlchemy versions)
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Setup engine configuration depending on SQLite vs PostgreSQL
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )
else:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)

# 3. Create a SessionLocal class. Each instance of this class will represent a database session.
# autocommit=False and autoflush=False give us transaction control.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 4. Create a Base class for models. Our database tables (models) will inherit from this Base.
Base = declarative_base()

# 5. Helper function (dependency) to yield a database session per request.
# The session is closed automatically when the request is complete.
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
