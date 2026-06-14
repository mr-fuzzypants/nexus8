"""
Development-only authentication.

Every request is authenticated as a shared "dev" user so the SPA can talk to
the API without a login flow. Enabled by settings only when DEBUG is on
(see NEXUS8_DEV_OPEN in settings.py) — never ship this in a real deployment.
"""

from django.contrib.auth import get_user_model
from rest_framework.authentication import BaseAuthentication

DEV_USERNAME = "dev"


class DevAutoAuthentication(BaseAuthentication):
    """Authenticate every request as the seeded dev user (no CSRF, no token)."""

    def authenticate(self, request):
        User = get_user_model()
        user, _ = User.objects.get_or_create(
            username=DEV_USERNAME,
            defaults={"first_name": "Dev", "is_staff": True},
        )
        return (user, None)
