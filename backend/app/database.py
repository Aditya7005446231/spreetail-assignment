from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# 1. Define the database file URL. We use a local SQLite file named "shared_expenses.db"
# located in the backend folder.
SQLALCHEMY_DATABASE_URL = "sqlite:///./shared_expenses.db"

# 2. Create the SQLite engine.
# check_same_thread=False is needed for SQLite when running in FastAPI because FastAPI can 
# handle requests on multiple threads, and SQLite by default restricts requests to the same thread.
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

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
