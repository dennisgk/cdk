from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import AppConfig, get_config

ACCESS_SUBJECT = "cdk-user"

password_hasher = PasswordHasher()
bearer_scheme = HTTPBearer(auto_error=False)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def create_access_token(config: AppConfig) -> tuple[str, datetime]:
    expires_at = datetime.now(UTC) + timedelta(
        minutes=config.access_token_expire_minutes
    )
    token = jwt.encode(
        {
            "sub": ACCESS_SUBJECT,
            "exp": expires_at,
        },
        config.jwt_secret,
        algorithm=config.jwt_algorithm,
    )
    return token, expires_at


def get_current_subject(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    config: AppConfig = Depends(get_config),
) -> str:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )

    try:
        payload = jwt.decode(
            credentials.credentials,
            config.jwt_secret,
            algorithms=[config.jwt_algorithm],
        )
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        ) from exc

    subject = payload.get("sub")
    if subject != ACCESS_SUBJECT:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject.",
        )

    return subject
