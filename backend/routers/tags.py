import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models import Account, AccountTag, Portfolio, PortfolioTag, Tag, User
from models.tag import DEFAULT_TAGS
from schemas.tenancy import TagCreate, TagOut, TagUpdate
from services import soft_delete

router = APIRouter()


def _usage(db: Session, user: User) -> tuple[dict, dict]:
    """Live accounts/portfolios per tag, across all of the user's tenants.

    Joining through Account/Portfolio means links to deleted parents never
    count — the global filter hides them on every joined entity.
    """
    accounts = dict(
        db.execute(
            select(AccountTag.tag_id, func.count(AccountTag.id))
            .join(Account, Account.id == AccountTag.account_id)
            .join(Tag, Tag.id == AccountTag.tag_id)
            .where(Tag.user_id == user.id)
            .group_by(AccountTag.tag_id)
        ).all()
    )
    portfolios = dict(
        db.execute(
            select(PortfolioTag.tag_id, func.count(PortfolioTag.id))
            .join(Portfolio, Portfolio.id == PortfolioTag.portfolio_id)
            .join(Tag, Tag.id == PortfolioTag.tag_id)
            .where(Tag.user_id == user.id)
            .group_by(PortfolioTag.tag_id)
        ).all()
    )
    return accounts, portfolios


def _out(tag: Tag, accounts: dict, portfolios: dict) -> TagOut:
    out = TagOut.model_validate(tag)
    out.account_count = accounts.get(tag.id, 0)
    out.portfolio_count = portfolios.get(tag.id, 0)
    return out


def _get_owned(db: Session, user: User, tag_id: uuid.UUID) -> Tag:
    tag = db.scalar(select(Tag).where(Tag.id == tag_id, Tag.user_id == user.id))
    if tag is None:
        raise HTTPException(status_code=404, detail="Tag not found")
    return tag


@router.get("", response_model=list[TagOut])
def list_tags(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[TagOut]:
    tags = db.scalars(select(Tag).where(Tag.user_id == user.id).order_by(Tag.name)).all()
    accounts, portfolios = _usage(db, user)
    return [_out(t, accounts, portfolios) for t in tags]


@router.post("", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(body: TagCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TagOut:
    tag = Tag(user_id=user.id, name=body.name, description=(body.description or "").strip() or None)
    db.add(tag)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A tag with that name already exists") from None
    db.refresh(tag)
    return _out(tag, {}, {})


@router.post("/seed", response_model=list[TagOut])
def seed_defaults(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[TagOut]:
    """Add any default tag that's missing; existing tags are left untouched."""
    existing = set(db.scalars(select(Tag.name).where(Tag.user_id == user.id)))
    for name, description in DEFAULT_TAGS:
        if name not in existing:
            db.add(Tag(user_id=user.id, name=name, description=description))
    db.commit()
    return list_tags(user, db)


@router.patch("/{tag_id}", response_model=TagOut)
def update_tag(tag_id: uuid.UUID, body: TagUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TagOut:
    tag = _get_owned(db, user, tag_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("name"):
        tag.name = data["name"]
    if "description" in data:
        tag.description = (data["description"] or "").strip() or None
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A tag with that name already exists") from None
    db.refresh(tag)
    accounts, portfolios = _usage(db, user)
    return _out(tag, accounts, portfolios)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    tag = _get_owned(db, user, tag_id)
    soft_delete.delete_tag(db, tag.id)
    db.commit()
