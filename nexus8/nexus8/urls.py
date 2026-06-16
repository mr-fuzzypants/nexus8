"""
URL configuration for nexus8 project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.contrib import admin
from django.urls import path, include, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    # API Documentation
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('admin/', admin.site.urls),
    # Note: Using simple URLs until Django REST Framework is installed
    # Switch to 'trackables.urls' when DRF is available
    path('trackables/', include('trackables.urls')),
    path('discussions/', include('discussions.urls')),
]

# Add silk profiling URLs
urlpatterns += [path('silk/', include('silk.urls', namespace='silk'))]

# Serve uploaded media (originals + thumbnails) in development, with HTTP Range
# support so <video> seeking fetches only the bytes it needs (see media_serve).
if settings.DEBUG:
    from nexus8.media_serve import serve_media_with_range

    _media_prefix = settings.MEDIA_URL.lstrip("/")
    urlpatterns += [
        re_path(
            rf"^{_media_prefix}(?P<path>.*)$",
            serve_media_with_range,
            {"document_root": settings.MEDIA_ROOT},
        ),
    ]