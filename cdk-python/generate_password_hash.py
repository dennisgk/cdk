from __future__ import annotations

import sys

from argon2 import PasswordHasher


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python generate_password_hash.py <password>")
        return 1

    print(PasswordHasher().hash(sys.argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
