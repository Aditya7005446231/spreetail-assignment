from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base
from .routers import users, groups, expenses, settlements, imports

# Create SQLite database tables on application start
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Shared Expenses API",
    description="Backend API for managing shared flatmate expenses and handling CSV imports.",
    version="1.0.0"
)

# Set up CORS middleware to allow the React development server to communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(users.router)
app.include_router(groups.router)
app.include_router(expenses.router)
app.include_router(settlements.router)
app.include_router(imports.router)

# Automatic Seeding on startup
@app.on_event("startup")
def startup_event():
    from .database import SessionLocal
    from .routers.imports import seed_group_and_members
    db = SessionLocal()
    try:
        # Seed group 1 (Flatmates) and its active membership dates
        seed_group_and_members(db)
        print("Database initialized and default group/timelines seeded successfully.")
    except Exception as e:
        print(f"Error seeding database: {e}")
    finally:
        db.close()

@app.get("/")
def read_root():
    return {
        "message": "Welcome to the Shared Expenses API. Navigate to /docs for API documentation."
    }
