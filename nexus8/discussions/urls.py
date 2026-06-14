from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import DiscussionViewSet, CommentViewSet, NoteViewSet

# Create router for API endpoints
router = DefaultRouter()
router.register(r'discussions', DiscussionViewSet)
router.register(r'comments', CommentViewSet)
router.register(r'notes', NoteViewSet)

app_name = 'discussions'

urlpatterns = [
    # API endpoints
    path('api/', include(router.urls)),
    
    # Custom API endpoints can be added here if needed
]
