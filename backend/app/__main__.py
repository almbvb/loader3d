"""`python -m app`: apply database migrations, then serve the API with uvicorn.

`python -m app make-admin EMAIL [--revoke]`: grant (or take away) access to the admin panel.
"""

import argparse
import asyncio
import sys

import uvicorn
from sqlalchemy import select

from app.config import BACKEND_DIR, Settings, get_settings
from app.db import create_engine, create_sessionmaker
from app.migrate import upgrade_database
from app.models import User


async def set_admin(settings: Settings, email: str, is_admin: bool) -> bool:
    """False if there is no account with this e-mail."""
    engine = create_engine(settings.sqlalchemy_url)
    try:
        async with create_sessionmaker(engine)() as db:
            user = await db.scalar(select(User).where(User.email == email.strip().lower()))
            if user is None:
                return False
            user.is_admin = is_admin
            await db.commit()
            return True
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app", description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true", help="restart on code changes (development)")
    parser.add_argument("--no-migrate", action="store_true", help="do not run `alembic upgrade head` first")
    commands = parser.add_subparsers(dest="command")
    make_admin = commands.add_parser("make-admin", help="grant access to the admin panel")
    make_admin.add_argument("email", help="e-mail of an existing account")
    make_admin.add_argument("--revoke", action="store_true", help="take the access away instead")
    args = parser.parse_args()

    settings = get_settings()
    if not args.no_migrate:
        upgrade_database(settings)

    if args.command == "make-admin":
        if not asyncio.run(set_admin(settings, args.email, not args.revoke)):
            sys.exit(f"No account with e-mail {args.email}")
        print(f"{args.email}: admin access {'revoked' if args.revoke else 'granted'}")
        return

    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=args.host,
        port=args.port,
        reload=args.reload,
        reload_dirs=[str(BACKEND_DIR / "app")] if args.reload else None,
        server_header=False,
    )


if __name__ == "__main__":
    main()
