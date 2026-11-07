import time
from collections import defaultdict, deque

from fastapi import APIRouter, Request, status

from app.auth import OptionalAuth
from app.db import Db
from app.errors import ApiError
from app.models import Lead
from app.schemas.leads import LeadIn

router = APIRouter(prefix="/leads", tags=["leads"])

# Per client IP, in this process: enough against a script hammering the public form.
RATE_LIMIT = 5
RATE_WINDOW_SECONDS = 600
_recent: defaultdict[str, deque[float]] = defaultdict(deque)


def _allow(ip: str) -> bool:
    now = time.monotonic()
    hits = _recent[ip]
    while hits and now - hits[0] > RATE_WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= RATE_LIMIT:
        return False
    hits.append(now)
    return True


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def create_lead(body: LeadIn, request: Request, auth: OptionalAuth, db: Db) -> None:
    """A request for the «Индивидуальный» tier or a demo; admins see it in the admin panel."""
    if body.website:
        return  # a bot filled in the hidden field: pretend it worked
    ip = request.client.host[:45] if request.client else None
    if not _allow(ip or "unknown"):
        raise ApiError(
            status.HTTP_429_TOO_MANY_REQUESTS, "too_many_requests", "Слишком много заявок, попробуйте позже"
        )
    db.add(
        Lead(
            name=body.name,
            email=body.email,
            phone=body.phone,
            company=body.company or None,
            message=body.message or None,
            tier=body.tier,
            user_id=auth.user.id if auth else None,
            ip_address=ip,
        )
    )
    await db.commit()
