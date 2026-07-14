# auth/rbac.py
"""Simple RBAC helper for Supabase.
Assumes a Supabase JWT token is passed via environment variable or header.
Provides functions to retrieve role and check permissions.
"""
import os
import json
import base64
from typing import List

# Example role/permission mapping (can be extended via Supabase tables)
ROLE_PERMISSIONS = {
    "admin": ["read", "write", "delete"],
    "reporter": ["read", "write"],
    "viewer": ["read"],
}

def _decode_jwt(token: str) -> dict:
    """Decode payload of a JWT (no verification)."""
    try:
        payload_part = token.split('.')[1]
        # Pad base64 string
        padding = '=' * (-len(payload_part) % 4)
        decoded = base64.urlsafe_b64decode(payload_part + padding)
        return json.loads(decoded)
    except Exception:
        return {}

def get_user_role(token: str) -> str:
    """Extract role claim from JWT. Returns 'viewer' if not found."""
    payload = _decode_jwt(token)
    return payload.get('role', 'viewer')

def has_permission(role: str, action: str) -> bool:
    """Check if a role is allowed to perform *action* (read/write/delete)."""
    allowed = ROLE_PERMISSIONS.get(role, [])
    return action in allowed

def assert_permission(token: str, action: str):
    role = get_user_role(token)
    if not has_permission(role, action):
        raise PermissionError(f"Role '{role}' does not have permission for '{action}'.")

if __name__ == "__main__":
    sample = os.getenv('SUPABASE_JWT') or ''
    print('Role:', get_user_role(sample))
    print('Can write?', has_permission(get_user_role(sample), 'write'))
