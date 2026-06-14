from django.urls import path, include
from django.views.generic import TemplateView

app_name = 'trackables'

# Simple placeholder patterns for basic Django compatibility
# These can be updated to use Django REST Framework when it's installed
urlpatterns = [
    path('', TemplateView.as_view(template_name='trackables/index.html'), name='index'),
    path('containers/', TemplateView.as_view(template_name='trackables/containers.html'), name='containers'),
]

# When Django REST Framework is installed, replace the above with:
# 
# from rest_framework.routers import DefaultRouter
# from .views import (
#     ContainerViewSet,
#     VersionViewSet,
#     ContainerVersionViewSet,
#     ContainerReferenceViewSet,
#     VersionedEntityViewSet,
#     SymlinkViewSet,
# )
# 
# router = DefaultRouter()
# router.register(r'containers', ContainerViewSet)
# router.register(r'versions', VersionViewSet)
# router.register(r'container-versions', ContainerVersionViewSet)
# router.register(r'container-references', ContainerReferenceViewSet)
# router.register(r'versioned-entities', VersionedEntityViewSet)
# router.register(r'symlinks', SymlinkViewSet)
# 
# urlpatterns = [
#     path('api/', include(router.urls)),
# ]
