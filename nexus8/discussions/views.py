from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.db.models import Q, Count, Prefetch
from django.utils import timezone

from .models import Discussion, Comment, Note
from .serializers import (
    DiscussionListSerializer, DiscussionDetailSerializer,
    CommentSerializer, CommentTreeSerializer, NoteSerializer
)
from trackables.models import VersionedEntity, Version, Container, ContainerVersion


class DiscussionViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Discussion operations with full CRUD and filtering.
    
    Provides discussions that can be attached to any trackable object.
    """
    queryset = Discussion.objects.all().select_related(
        'versioned_entity', 
        'version', 
        'version__entity',  # CRITICAL: Prevents N+1 queries when accessing version.entity.code/name
        'container', 
        'container_version'
    ).prefetch_related('comments')
    permission_classes = [permissions.AllowAny]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        'discussion_type', 'priority', 'status', 'created_by', 'assigned_to',
        'versioned_entity', 'version', 'container', 'container_version'
    ]
    search_fields = ['title', 'description', 'created_by', 'assigned_to']
    ordering_fields = ['created_at', 'updated_at', 'last_activity', 'priority']
    ordering = ['-last_activity', '-created_at']
    
    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == 'list':
            return DiscussionListSerializer
        return DiscussionDetailSerializer
    
    def get_queryset(self):
        """Customize queryset based on query parameters."""
        queryset = self.queryset
        
        # Filter by attached object type
        attached_to = self.request.query_params.get('attached_to')
        if attached_to:
            if attached_to == 'entity':
                queryset = queryset.filter(versioned_entity__isnull=False)
            elif attached_to == 'version':
                queryset = queryset.filter(version__isnull=False)
            elif attached_to == 'container':
                queryset = queryset.filter(container__isnull=False)
            elif attached_to == 'container_version':
                queryset = queryset.filter(container_version__isnull=False)
        
        # Filter by tags
        tags = self.request.query_params.get('tags')
        if tags:
            tag_list = [tag.strip() for tag in tags.split(',')]
            queryset = queryset.filter(tags__overlap=tag_list)
        
        # Filter active discussions (not closed)
        if self.request.query_params.get('active_only', '').lower() == 'true':
            queryset = queryset.exclude(status='closed')
        
        # Filter by priority
        priority = self.request.query_params.get('priority')
        if priority:
            priorities = [p.strip() for p in priority.split(',')]
            queryset = queryset.filter(priority__in=priorities)
        
        return queryset
    
    @action(detail=True, methods=['post'])
    def add_comment(self, request, pk=None):
        """Add a comment to the discussion."""
        discussion = self.get_object()
        author = request.user.username if hasattr(request.user, 'username') else 'anonymous'

        # discussion/author are required serializer fields — inject them before
        # validation, not at save time, or is_valid() always fails.
        serializer = CommentSerializer(
            data={**request.data, 'discussion': discussion.id, 'author': author}
        )
        if serializer.is_valid():
            comment = serializer.save(discussion=discussion, author=author)
            
            # Update discussion participants and last activity
            discussion.add_participant(comment.author)
            discussion.last_activity = timezone.now()
            discussion.save(update_fields=['participants', 'last_activity'])
            
            return Response(CommentSerializer(comment).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['get'])
    def comments(self, request, pk=None):
        """Get all comments for this discussion with threading."""
        discussion = self.get_object()
        
        # Get top-level comments (no parent)
        top_level_comments = discussion.comments.filter(parent_comment__isnull=True).order_by('created_at')
        
        # Use tree serializer to include nested replies
        serializer = CommentTreeSerializer(top_level_comments, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def change_status(self, request, pk=None):
        """Change the status of the discussion."""
        discussion = self.get_object()
        new_status = request.data.get('status')
        
        if new_status not in ['open', 'in_progress', 'resolved', 'closed']:
            return Response(
                {'error': 'Invalid status. Must be one of: open, in_progress, resolved, closed'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        discussion.status = new_status
        discussion.last_activity = timezone.now()
        discussion.save(update_fields=['status', 'last_activity'])
        
        return Response(DiscussionDetailSerializer(discussion).data)
    
    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        """Assign the discussion to a user."""
        discussion = self.get_object()
        assigned_to = request.data.get('assigned_to')
        
        discussion.assigned_to = assigned_to
        discussion.last_activity = timezone.now()
        discussion.save(update_fields=['assigned_to', 'last_activity'])
        
        if assigned_to:
            discussion.add_participant(assigned_to)
        
        return Response(DiscussionDetailSerializer(discussion).data)
    
    @action(detail=False, methods=['get'])
    def my_discussions(self, request):
        """Get discussions created by or assigned to the current user."""
        username = request.user.username if hasattr(request.user, 'username') else 'anonymous'
        
        discussions = self.get_queryset().filter(
            Q(created_by=username) | Q(assigned_to=username)
        )
        
        serializer = DiscussionListSerializer(discussions, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def by_object(self, request):
        """Get discussions for a specific object."""
        object_type = request.query_params.get('object_type')
        object_id = request.query_params.get('object_id')
        
        if not object_type or not object_id:
            return Response(
                {'error': 'Both object_type and object_id are required'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        filter_kwargs = {}
        if object_type == 'entity':
            filter_kwargs['versioned_entity_id'] = object_id
        elif object_type == 'version':
            filter_kwargs['version_id'] = object_id
        elif object_type == 'container':
            filter_kwargs['container_id'] = object_id
        elif object_type == 'container_version':
            filter_kwargs['container_version_id'] = object_id
        else:
            return Response(
                {'error': 'Invalid object_type. Must be: entity, version, container, or container_version'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        discussions = self.get_queryset().filter(**filter_kwargs)
        serializer = DiscussionListSerializer(discussions, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """Get discussion statistics."""
        queryset = self.get_queryset()
        
        stats = {
            'total_discussions': queryset.count(),
            'by_status': {},
            'by_priority': {},
            'by_type': {},
            'active_discussions': queryset.exclude(status='closed').count(),
            'my_discussions': queryset.filter(
                Q(created_by=request.user.username) | Q(assigned_to=request.user.username)
            ).count() if hasattr(request.user, 'username') else 0
        }
        
        # Status breakdown
        status_counts = queryset.values('status').annotate(count=Count('id'))
        for item in status_counts:
            stats['by_status'][item['status']] = item['count']
        
        # Priority breakdown
        priority_counts = queryset.values('priority').annotate(count=Count('id'))
        for item in priority_counts:
            stats['by_priority'][item['priority']] = item['count']
        
        # Type breakdown
        type_counts = queryset.values('discussion_type').annotate(count=Count('id'))
        for item in type_counts:
            stats['by_type'][item['discussion_type']] = item['count']
        
        return Response(stats)


class CommentViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Comment operations with threading support.
    """
    queryset = Comment.objects.all().select_related('discussion', 'parent_comment')
    serializer_class = CommentSerializer
    permission_classes = [permissions.AllowAny]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['discussion', 'author', 'comment_type', 'parent_comment']
    search_fields = ['content', 'author']
    ordering_fields = ['created_at', 'updated_at']
    ordering = ['created_at']
    
    def perform_create(self, serializer):
        """Set the author when creating a comment."""
        author = self.request.user.username if hasattr(self.request.user, 'username') else 'anonymous'
        comment = serializer.save(author=author)
        
        # Update discussion participants and last activity
        discussion = comment.discussion
        discussion.add_participant(author)
        discussion.last_activity = timezone.now()
        discussion.save(update_fields=['participants', 'last_activity'])
    
    @action(detail=True, methods=['post'])
    def add_reaction(self, request, pk=None):
        """Add a reaction to the comment."""
        comment = self.get_object()
        emoji = request.data.get('emoji')
        username = request.user.username if hasattr(request.user, 'username') else 'anonymous'
        
        if not emoji:
            return Response({'error': 'Emoji is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        comment.add_reaction(emoji, username)
        return Response(CommentSerializer(comment).data)
    
    @action(detail=True, methods=['delete'])
    def remove_reaction(self, request, pk=None):
        """Remove a reaction from the comment."""
        comment = self.get_object()
        emoji = request.data.get('emoji')
        username = request.user.username if hasattr(request.user, 'username') else 'anonymous'
        
        if not emoji:
            return Response({'error': 'Emoji is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        comment.remove_reaction(emoji, username)
        return Response(CommentSerializer(comment).data)
    
    @action(detail=True, methods=['get'])
    def replies(self, request, pk=None):
        """Get all replies to this comment."""
        comment = self.get_object()
        replies = comment.replies.order_by('created_at')
        serializer = CommentSerializer(replies, many=True)
        return Response(serializer.data)


class NoteViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Note operations with todo and reminder support.
    """
    queryset = Note.objects.all().select_related(
        'versioned_entity', 
        'version', 
        'version__entity',  # CRITICAL: This prevents N+1 queries when accessing version.entity.code/name
        'container', 
        'container_version'
    )
    serializer_class = NoteSerializer
    permission_classes = [permissions.AllowAny]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        'note_type', 'author', 'is_completed',
        'versioned_entity', 'version', 'container', 'container_version'
    ]
    search_fields = ['title', 'content', 'author']
    ordering_fields = ['created_at', 'updated_at', 'reminder_at']
    ordering = ['-created_at']
    
    def get_queryset(self):
        """Customize queryset based on query parameters."""
        queryset = self.queryset
        
        # Filter by tags
        tags = self.request.query_params.get('tags')
        if tags:
            tag_list = [tag.strip() for tag in tags.split(',')]
            queryset = queryset.filter(tags__overlap=tag_list)
        
        # Filter todos only
        if self.request.query_params.get('todos_only', '').lower() == 'true':
            queryset = queryset.filter(note_type='todo')
        
        # Filter by completion status
        completed = self.request.query_params.get('completed')
        if completed is not None:
            is_completed = completed.lower() == 'true'
            queryset = queryset.filter(is_completed=is_completed)
        
        # Filter by reminder date
        has_reminder = self.request.query_params.get('has_reminder')
        if has_reminder is not None:
            has_reminder_bool = has_reminder.lower() == 'true'
            if has_reminder_bool:
                queryset = queryset.filter(reminder_at__isnull=False)
            else:
                queryset = queryset.filter(reminder_at__isnull=True)
        
        # Filter overdue reminders
        if self.request.query_params.get('overdue_only', '').lower() == 'true':
            queryset = queryset.filter(
                reminder_at__lt=timezone.now(),
                is_completed=False
            )
        
        return queryset
    
    @action(detail=True, methods=['post'])
    def complete_todo(self, request, pk=None):
        """Mark a todo note as completed."""
        note = self.get_object()
        note.is_completed = True
        note.save(update_fields=['is_completed'])
        
        return Response(NoteSerializer(note).data)
    
    @action(detail=True, methods=['post'])
    def uncomplete_todo(self, request, pk=None):
        """Mark a todo note as not completed."""
        note = self.get_object()
        note.is_completed = False
        note.save(update_fields=['is_completed'])
        
        return Response(NoteSerializer(note).data)
    
    @action(detail=True, methods=['post'])
    def set_reminder(self, request, pk=None):
        """Set a reminder date for the note."""
        note = self.get_object()
        reminder_at = request.data.get('reminder_at')
        
        if reminder_at:
            from django.utils.dateparse import parse_datetime
            parsed_date = parse_datetime(reminder_at)
            if not parsed_date:
                return Response(
                    {'error': 'Invalid datetime format. Use ISO format: YYYY-MM-DDTHH:MM:SS'}, 
                    status=status.HTTP_400_BAD_REQUEST
                )
            note.reminder_at = parsed_date
        else:
            note.reminder_at = None
        
        note.save(update_fields=['reminder_at'])
        return Response(NoteSerializer(note).data)
    
    @action(detail=False, methods=['get'])
    def my_notes(self, request):
        """Get notes created by the current user."""
        username = request.user.username if hasattr(request.user, 'username') else 'anonymous'
        notes = self.get_queryset().filter(author=username)
        serializer = NoteSerializer(notes, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def my_todos(self, request):
        """Get todo notes created by the current user."""
        username = request.user.username if hasattr(request.user, 'username') else 'anonymous'
        todos = self.get_queryset().filter(
            author=username,
            note_type='todo'
        )
        
        serializer = NoteSerializer(todos, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def upcoming_reminders(self, request):
        """Get upcoming reminders for the current user."""
        username = request.user.username if hasattr(request.user, 'username') else 'anonymous'
        
        # Get reminders for the next 7 days
        end_date = timezone.now() + timezone.timedelta(days=7)
        
        reminders = self.get_queryset().filter(
            author=username,
            reminder_at__gte=timezone.now(),
            reminder_at__lte=end_date,
            is_completed=False
        ).order_by('reminder_at')
        
        serializer = NoteSerializer(reminders, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def by_object(self, request):
        """Get notes for a specific object."""
        object_type = request.query_params.get('object_type')
        object_id = request.query_params.get('object_id')
        
        if not object_type or not object_id:
            return Response(
                {'error': 'Both object_type and object_id are required'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        filter_kwargs = {}
        if object_type == 'entity':
            filter_kwargs['versioned_entity_id'] = object_id
        elif object_type == 'version':
            filter_kwargs['version_id'] = object_id
        elif object_type == 'container':
            filter_kwargs['container_id'] = object_id
        elif object_type == 'container_version':
            filter_kwargs['container_version_id'] = object_id
        else:
            return Response(
                {'error': 'Invalid object_type. Must be: entity, version, container, or container_version'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        notes = self.get_queryset().filter(**filter_kwargs)
        serializer = NoteSerializer(notes, many=True)
        return Response(serializer.data)
