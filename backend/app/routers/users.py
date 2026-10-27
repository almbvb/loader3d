from fastapi import APIRouter, Request, Response, status

from app.auth import CurrentAuth, clear_refresh_cookie, revoke_sessions
from app.db import Db
from app.errors import ApiError
from app.schemas.auth import AccountDeleteIn, PasswordChangeIn, UserOut, UserUpdateIn
from app.security import hash_password, verify_password

router = APIRouter(prefix="/users", tags=["users"])


def _wrong_password() -> ApiError:
    return ApiError(status.HTTP_400_BAD_REQUEST, "wrong_password", "Неверный пароль")


@router.get("/me")
async def get_me(auth: CurrentAuth) -> UserOut:
    return UserOut.model_validate(auth.user)


@router.patch("/me")
async def update_me(body: UserUpdateIn, auth: CurrentAuth, db: Db) -> UserOut:
    if body.display_name is not None:
        auth.user.display_name = body.display_name
    await db.commit()
    return UserOut.model_validate(auth.user)


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(body: PasswordChangeIn, auth: CurrentAuth, db: Db) -> None:
    """Changes the password and ends every other session; the current one stays logged in."""
    if not await verify_password(auth.user.password_hash, body.current_password):
        raise _wrong_password()
    auth.user.password_hash = await hash_password(body.new_password)
    await revoke_sessions(db, auth.user.id, keep=auth.session.id)
    await db.commit()


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    body: AccountDeleteIn, auth: CurrentAuth, request: Request, response: Response, db: Db
) -> None:
    """Deletes the account with all its plans and sessions. Requires the password."""
    if not await verify_password(auth.user.password_hash, body.password):
        raise _wrong_password()
    await db.delete(auth.user)
    await db.commit()
    clear_refresh_cookie(response, request)
