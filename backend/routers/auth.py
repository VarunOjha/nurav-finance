from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models import Tag, Tenant, User
from models.tag import DEFAULT_TAGS
from models.tenant import DEFAULT_TENANT_NAME
from schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    ProfileUpdate,
    RegisterRequest,
    TokenResponse,
    UserOut,
)
from services.security import create_access_token, hash_password, password_problem, verify_password

router = APIRouter()


def _email_taken(db: Session, email: str, exclude_id=None) -> bool:
    stmt = select(User.id).where(User.email == email)
    if exclude_id is not None:
        stmt = stmt.where(User.id != exclude_id)
    return db.scalar(stmt) is not None


def _token_response(user: User) -> TokenResponse:
    return TokenResponse(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    problem = password_problem(body.password)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    email = body.email.lower()
    if _email_taken(db, email):
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    user = User(
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        date_of_birth=body.date_of_birth,
        gender=body.gender,
        email=email,
        phone=(body.phone or "").strip() or None,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.flush()
    db.add(Tenant(user_id=user.id, name=DEFAULT_TENANT_NAME, description="Me — my own accounts and portfolios", is_default=True))
    for name, description in DEFAULT_TAGS:
        db.add(Tag(user_id=user.id, name=name, description=description))
    db.commit()
    db.refresh(user)
    return _token_response(user)


def _authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email.lower()))
    if user is None or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return user


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    return _token_response(_authenticate(db, body.email, body.password))


@router.post("/token", include_in_schema=False)
def token(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)) -> dict:
    """OAuth2 form flow so the interactive /api/docs "Authorize" button works."""
    user = _authenticate(db, form.username, form.password)
    return {"access_token": create_access_token(user.id), "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.patch("/me", response_model=UserOut)
def update_me(body: ProfileUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    data = body.model_dump(exclude_unset=True)
    if "email" in data and data["email"] is not None:
        data["email"] = data["email"].lower()
        if _email_taken(db, data["email"], exclude_id=user.id):
            raise HTTPException(status_code=409, detail="An account with this email already exists")
    for field in ("first_name", "last_name", "email"):
        if field in data and data[field] is None:
            del data[field]  # required columns can't be cleared
    for field, value in data.items():
        setattr(user, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(user)
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: ChangePasswordRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    problem = password_problem(body.new_password)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    user.password_hash = hash_password(body.new_password)
    db.commit()
