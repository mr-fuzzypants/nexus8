from django.db import models
from django.utils import timezone
from trackables.models import Trackable, VersionedEntity, Version, Container, ContainerVersion


class DiscussionManager(models.Manager):
    """Custom manager for Discussion with convenience methods."""
    
    def for_entity(self, entity):
        """Get all discussions for a VersionedEntity."""
        return self.filter(versioned_entity=entity)
    
    def for_version(self, version):
        """Get all discussions for a specific Version."""
        return self.filter(version=version)
    
    def for_container(self, container):
        """Get all discussions for a Container."""
        return self.filter(container=container)
    
    def for_container_version(self, container_version):
        """Get all discussions for a ContainerVersion."""
        return self.filter(container_version=container_version)
    
    def for_object(self, obj):
        """Get all discussions for any trackable object (convenience method)."""
        if isinstance(obj, VersionedEntity):
            return self.for_entity(obj)
        elif isinstance(obj, Version):
            return self.for_version(obj)
        elif isinstance(obj, Container):
            return self.for_container(obj)
        elif hasattr(obj, '_meta') and obj._meta.model_name == 'containerversion':
            return self.for_container_version(obj)
        else:
            return self.none()
    
    def active_discussions(self):
        """Get discussions that are not closed."""
        return self.exclude(status='closed')
    
    def by_priority(self, priority):
        """Filter discussions by priority level."""
        return self.filter(priority=priority)
    
    def bulk_create_optimized(self, discussions_data, batch_size=100):
        """
        Optimized bulk creation of discussions with pre-fetched entities.
        
        Args:
            discussions_data: List of dicts with discussion data
            batch_size: Number of discussions to create per batch
            
        Returns:
            List of created Discussion objects
        """
        from django.db import transaction
        
        created_discussions = []
        discussions_batch = []
        
        # Pre-fetch all entities to avoid N+1 queries
        entity_ids = [d.get('versioned_entity_id') for d in discussions_data if d.get('versioned_entity_id')]
        version_ids = [d.get('version_id') for d in discussions_data if d.get('version_id')]
        container_ids = [d.get('container_id') for d in discussions_data if d.get('container_id')]
        container_version_ids = [d.get('container_version_id') for d in discussions_data if d.get('container_version_id')]
        
        # Pre-fetch entities to ensure they exist
        if entity_ids:
            VersionedEntity.objects.filter(id__in=entity_ids).exists()
        if version_ids:
            Version.objects.filter(id__in=version_ids).exists()
        if container_ids:
            Container.objects.filter(id__in=container_ids).exists()
        if container_version_ids:
            ContainerVersion.objects.filter(id__in=container_version_ids).exists()
        
        # Create Discussion objects in batches
        for data in discussions_data:
            # Convert object instances to IDs if needed
            versioned_entity_id = None
            version_id = None
            container_id = None
            container_version_id = None
            
            if 'versioned_entity' in data:
                versioned_entity_id = data['versioned_entity'].id if data['versioned_entity'] else None
            elif 'versioned_entity_id' in data:
                versioned_entity_id = data['versioned_entity_id']
            
            if 'version' in data:
                version_id = data['version'].id if data['version'] else None
            elif 'version_id' in data:
                version_id = data['version_id']
            
            if 'container' in data:
                container_id = data['container'].id if data['container'] else None
            elif 'container_id' in data:
                container_id = data['container_id']
            
            if 'container_version' in data:
                container_version_id = data['container_version'].id if data['container_version'] else None
            elif 'container_version_id' in data:
                container_version_id = data['container_version_id']
            
            discussion = Discussion(
                versioned_entity_id=versioned_entity_id,
                version_id=version_id,
                container_id=container_id,
                container_version_id=container_version_id,
                title=data['title'],
                description=data.get('description', ''),
                discussion_type=data.get('discussion_type', 'general'),
                priority=data.get('priority', 'normal'),
                status=data.get('status', 'open'),
                created_by=data['created_by'],
                assigned_to=data.get('assigned_to', ''),
                tags=data.get('tags', []),
                metadata=data.get('metadata', {})
            )
            discussions_batch.append(discussion)
            
            if len(discussions_batch) >= batch_size:
                with transaction.atomic():
                    batch_created = self.bulk_create(discussions_batch)
                    created_discussions.extend(batch_created)
                discussions_batch = []
        
        # Create remaining discussions
        if discussions_batch:
            with transaction.atomic():
                batch_created = self.bulk_create(discussions_batch)
                created_discussions.extend(batch_created)
        
        return created_discussions


class Discussion(Trackable):
    """
    A discussion thread that can be attached to trackable objects.
    Uses explicit foreign keys instead of GenericForeignKey for better performance and integrity.
    """
    
    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('normal', 'Normal'), 
        ('high', 'High'),
        ('urgent', 'Urgent'),
    ]
    
    STATUS_CHOICES = [
        ('open', 'Open'),
        ('in_progress', 'In Progress'),
        ('resolved', 'Resolved'),
        ('closed', 'Closed'),
    ]
    
    DISCUSSION_TYPE_CHOICES = [
        ('general', 'General Discussion'),
        ('issue', 'Issue/Bug Report'),
        ('feature_request', 'Feature Request'),
        ('review', 'Code/Asset Review'),
        ('question', 'Question'),
        ('decision', 'Decision Required'),
    ]
    
    # Explicit foreign keys - only one should be set per discussion
    versioned_entity = models.ForeignKey(
        VersionedEntity, 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='entity_discussions'
    )
    version = models.ForeignKey(
        Version, 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='version_discussions'
    )
    container = models.ForeignKey(
        Container, 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='container_discussions'
    )
    container_version = models.ForeignKey(
        ContainerVersion,
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='container_version_discussions'
    )
    
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    discussion_type = models.CharField(max_length=20, choices=DISCUSSION_TYPE_CHOICES, default='general')
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='normal')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='open')
    
    # User fields - using string references to avoid import issues
    created_by = models.CharField(max_length=100, help_text="Username of discussion creator")
    assigned_to = models.CharField(max_length=100, blank=True, help_text="Username of assigned person")
    
    # Metadata
    tags = models.JSONField(default=list, blank=True, help_text="List of tags for categorization")
    metadata = models.JSONField(default=dict, blank=True, help_text="Additional metadata")
    
    # Tracking fields
    last_activity = models.DateTimeField(auto_now=True)
    participants = models.JSONField(default=list, blank=True, help_text="List of usernames who participated")
    
    objects = DiscussionManager()
    
    class Meta:
        ordering = ['-last_activity', '-created_at']
        indexes = [
            # Individual foreign key indexes for performance
            models.Index(fields=['versioned_entity']),
            models.Index(fields=['version']),
            models.Index(fields=['container']),
            models.Index(fields=['container_version']),
            # Combined indexes for common queries
            models.Index(fields=['status', 'priority']),
            models.Index(fields=['created_by']),
            models.Index(fields=['discussion_type']),
            models.Index(fields=['last_activity']),
        ]
        constraints = [
            # Ensure exactly one foreign key is set
            models.CheckConstraint(
                check=(
                    models.Q(versioned_entity__isnull=False, version__isnull=True, container__isnull=True, container_version__isnull=True) |
                    models.Q(versioned_entity__isnull=True, version__isnull=False, container__isnull=True, container_version__isnull=True) |
                    models.Q(versioned_entity__isnull=True, version__isnull=True, container__isnull=False, container_version__isnull=True) |
                    models.Q(versioned_entity__isnull=True, version__isnull=True, container__isnull=True, container_version__isnull=False)
                ),
                name='discussion_single_parent_constraint'
            )
        ]
    
    def __str__(self):
        return f"Discussion: {self.title} ({self.get_status_display()})"
    
    def get_attached_object(self):
        """Get the object this discussion is attached to."""
        if self.versioned_entity:
            return self.versioned_entity
        elif self.version:
            return self.version
        elif self.container:
            return self.container
        elif self.container_version:
            return self.container_version
        return None
    
    def get_attached_object_type(self):
        """Get the type name of the attached object."""
        obj = self.get_attached_object()
        if obj:
            return obj._meta.model_name
        return None
    
    def add_participant(self, username):
        """Add a user to the participants list."""
        if username not in self.participants:
            self.participants.append(username)
            self.save(update_fields=['participants'])
    
    def close_discussion(self, resolved=True):
        """Close the discussion, optionally marking as resolved."""
        self.status = 'resolved' if resolved else 'closed'
        self.save(update_fields=['status', 'last_activity'])
    
    def get_comment_count(self):
        """Get the total number of comments in this discussion."""
        return self.comments.count()
    
    def get_recent_activity(self, days=7):
        """Get recent comments within specified days."""
        from datetime import timedelta
        cutoff = timezone.now() - timedelta(days=days)
        return self.comments.filter(created_at__gte=cutoff).order_by('-created_at')
    
    def clean(self):
        """Validate that exactly one foreign key is set."""
        from django.core.exceptions import ValidationError
        fk_fields = [self.versioned_entity, self.version, self.container, self.container_version]
        non_null_count = sum(1 for field in fk_fields if field is not None)
        
        if non_null_count == 0:
            raise ValidationError("Discussion must be attached to exactly one object.")
        elif non_null_count > 1:
            raise ValidationError("Discussion can only be attached to one object at a time.")


class CommentManager(models.Manager):
    """Custom manager for Comment with convenience methods."""
    
    def by_author(self, username):
        """Get comments by specific author."""
        return self.filter(author=username)
    
    def recent(self, hours=24):
        """Get recent comments within specified hours."""
        from datetime import timedelta
        cutoff = timezone.now() - timedelta(hours=hours)
        return self.filter(created_at__gte=cutoff)
    
    def with_attachments(self):
        """Get comments that have attachments."""
        return self.exclude(attachments__exact=[])
    
    def bulk_create_threaded(self, comments_data, batch_size=100):
        """
        Optimized bulk creation of comments with threading support.
        Creates root comments first, then threaded replies in separate phase.
        
        Args:
            comments_data: List of dicts with comment data
            batch_size: Number of comments to create per batch
            
        Returns:
            Dict with 'root_comments' and 'threaded_comments' lists
        """
        from django.db import transaction
        
        # Separate root comments from threaded replies
        root_comments_data = []
        threaded_comments_data = []
        
        for data in comments_data:
            if data.get('parent_comment_id'):
                threaded_comments_data.append(data)
            else:
                root_comments_data.append(data)
        
        created_root_comments = []
        created_threaded_comments = []
        
        # Phase 1: Create root comments using bulk_create
        if root_comments_data:
            root_comments_batch = []
            
            for data in root_comments_data:
                # Handle both object instances and IDs
                discussion_id = None
                if 'discussion' in data:
                    discussion_id = data['discussion'].id if data['discussion'] else None
                elif 'discussion_id' in data:
                    discussion_id = data['discussion_id']
                
                comment = Comment(
                    discussion_id=discussion_id,
                    content=data['content'],
                    comment_type=data.get('comment_type', 'comment'),
                    author=data['author'],
                    attachments=data.get('attachments', []),
                    mentions=data.get('mentions', []),
                    reactions=data.get('reactions', {}),
                    metadata=data.get('metadata', {})
                )
                root_comments_batch.append(comment)
                
                if len(root_comments_batch) >= batch_size:
                    with transaction.atomic():
                        batch_created = self.bulk_create(root_comments_batch)
                        created_root_comments.extend(batch_created)
                    root_comments_batch = []
            
            # Create remaining root comments
            if root_comments_batch:
                with transaction.atomic():
                    batch_created = self.bulk_create(root_comments_batch)
                    created_root_comments.extend(batch_created)
        
        # Phase 2: Create threaded replies (must be done individually due to parent_comment FK)
        if threaded_comments_data:
            with transaction.atomic():
                for data in threaded_comments_data:
                    try:
                        comment = Comment.objects.create(
                            discussion_id=data['discussion_id'],
                            parent_comment_id=data['parent_comment_id'],
                            content=data['content'],
                            comment_type=data.get('comment_type', 'comment'),
                            author=data['author'],
                            attachments=data.get('attachments', []),
                            mentions=data.get('mentions', []),
                            reactions=data.get('reactions', {}),
                            metadata=data.get('metadata', {})
                        )
                        created_threaded_comments.append(comment)
                    except Exception as e:
                        # Log error but continue with other comments
                        print(f"Error creating threaded comment: {e}")
        
        return {
            'root_comments': created_root_comments,
            'threaded_comments': created_threaded_comments,
            'total_created': len(created_root_comments) + len(created_threaded_comments)
        }
    
    def bulk_update_reactions(self, comment_reactions_data, batch_size=100):
        """
        Optimized bulk update of comment reactions.
        
        Args:
            comment_reactions_data: List of dicts with {'comment_id': id, 'reactions': {}}
            batch_size: Number of comments to update per batch
        """
        from django.db import transaction
        
        comments_to_update = []
        
        for data in comment_reactions_data:
            # Handle both comment objects and comment IDs
            if 'comment' in data:
                comment = data['comment']
            elif 'comment_id' in data:
                comment = self.get(id=data['comment_id'])
            else:
                continue
                
            if comment:
                comment.reactions = data['reactions']
                comments_to_update.append(comment)
                
                if len(comments_to_update) >= batch_size:
                    with transaction.atomic():
                        self.bulk_update(comments_to_update, ['reactions'])
                    comments_to_update = []
        
        # Update remaining comments
        if comments_to_update:
            with transaction.atomic():
                self.bulk_update(comments_to_update, ['reactions'])
        
        return len(comment_reactions_data)


class Comment(Trackable):
    """
    A comment within a discussion thread.
    Supports rich content, mentions, attachments, and reactions.
    """
    
    COMMENT_TYPE_CHOICES = [
        ('comment', 'Regular Comment'),
        ('note', 'Internal Note'),
        ('status_change', 'Status Change'),
        ('assignment', 'Assignment Change'),
        ('system', 'System Generated'),
    ]
    
    discussion = models.ForeignKey(
        Discussion, 
        on_delete=models.CASCADE, 
        related_name='comments'
    )
    
    # Content
    content = models.TextField(help_text="Main comment content (supports markdown)")
    comment_type = models.CharField(max_length=15, choices=COMMENT_TYPE_CHOICES, default='comment')
    
    # User info
    author = models.CharField(max_length=100, help_text="Username of comment author")
    
    # Rich content support
    attachments = models.JSONField(
        default=list, 
        blank=True,
        help_text="List of attachment info: [{'name': 'file.png', 'path': '/uploads/...', 'size': 1024}]"
    )
    mentions = models.JSONField(
        default=list, 
        blank=True,
        help_text="List of mentioned usernames"
    )
    
    # Reactions and engagement
    reactions = models.JSONField(
        default=dict, 
        blank=True,
        help_text="Reactions: {'👍': ['user1', 'user2'], '❤️': ['user3']}"
    )
    
    # Threading support
    parent_comment = models.ForeignKey(
        'self', 
        null=True, 
        blank=True, 
        on_delete=models.CASCADE,
        related_name='replies'
    )
    
    # Metadata
    is_edited = models.BooleanField(default=False)
    edit_history = models.JSONField(default=list, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    
    objects = CommentManager()
    
    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['discussion', 'created_at']),
            models.Index(fields=['author']),
            models.Index(fields=['comment_type']),
            models.Index(fields=['parent_comment']),
        ]
    
    def __str__(self):
        preview = self.content[:50] + "..." if len(self.content) > 50 else self.content
        return f"Comment by {self.author}: {preview}"
    
    def add_reaction(self, emoji, username): 
        """Add a reaction to the comment."""
        if emoji not in self.reactions:
            self.reactions[emoji] = []
        if username not in self.reactions[emoji]:
            self.reactions[emoji].append(username)
            self.save(update_fields=['reactions'])
    
    def remove_reaction(self, emoji, username):
        """Remove a reaction from the comment."""
        if emoji in self.reactions and username in self.reactions[emoji]:
            self.reactions[emoji].remove(username)
            if not self.reactions[emoji]:  # Remove empty reaction lists
                del self.reactions[emoji]
            self.save(update_fields=['reactions'])
    
    def edit_content(self, new_content, editor_username):
        """Edit comment content with history tracking."""
        if not self.edit_history:
            self.edit_history = []
        
        # Save previous version to history
        self.edit_history.append({
            'content': self.content,
            'edited_by': editor_username,
            'edited_at': timezone.now().isoformat()
        })
        
        self.content = new_content
        self.is_edited = True
        self.save(update_fields=['content', 'is_edited', 'edit_history'])
    
    def get_thread_depth(self):
        """Get the depth of this comment in the thread (0 for top-level)."""
        depth = 0
        current = self.parent_comment
        while current:
            depth += 1
            current = current.parent_comment
        return depth
    
    def save(self, *args, **kwargs):
        # Update discussion's last activity and add participant
        if self.discussion_id:
            Discussion.objects.filter(id=self.discussion_id).update(
                last_activity=timezone.now()
            )
            # Add author as participant
            discussion = Discussion.objects.get(id=self.discussion_id)
            discussion.add_participant(self.author)
        
        super().save(*args, **kwargs)


class NoteManager(models.Manager):
    """Custom manager for Note with convenience methods."""
    
    def for_entity(self, entity):
        """Get all notes for a VersionedEntity."""
        return self.filter(versioned_entity=entity)
    
    def for_version(self, version):
        """Get all notes for a specific Version."""
        return self.filter(version=version)
    
    def for_container(self, container):
        """Get all notes for a Container."""
        return self.filter(container=container)
    
    def for_container_version(self, container_version):
        """Get all notes for a ContainerVersion."""
        return self.filter(container_version=container_version)
    
    def for_object(self, obj):
        """Get all notes for any trackable object (convenience method)."""
        if isinstance(obj, VersionedEntity):
            return self.for_entity(obj)
        elif isinstance(obj, Version):
            return self.for_version(obj)
        elif isinstance(obj, Container):
            return self.for_container(obj)
        elif hasattr(obj, '_meta') and obj._meta.model_name == 'containerversion':
            return self.for_container_version(obj)
        else:
            return self.none()
    
    def todos(self):
        """Get all todo-type notes."""
        return self.filter(note_type='todo')
    
    def incomplete_todos(self):
        """Get incomplete todo notes."""
        return self.filter(note_type='todo', is_completed=False)
    
    def by_author(self, username):
        """Get notes by specific author."""
        return self.filter(author=username)


class Note(Trackable):
    """
    Standalone notes that can be attached to trackable objects.
    Uses explicit foreign keys instead of GenericForeignKey for better performance.
    """
    
    NOTE_TYPE_CHOICES = [
        ('general', 'General Note'),
        ('todo', 'Todo Item'),
        ('reminder', 'Reminder'),
        ('issue', 'Issue Note'),
        ('review', 'Review Note'),
        ('documentation', 'Documentation'),
    ]
    
    # Explicit foreign keys - only one should be set per note
    versioned_entity = models.ForeignKey(
        VersionedEntity, 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='entity_notes'
    )
    version = models.ForeignKey(
        Version, 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='version_notes'
    )
    container = models.ForeignKey(
        Container, 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='container_notes'
    )
    container_version = models.ForeignKey(
        ContainerVersion,
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='container_version_notes'
    )
    
    title = models.CharField(max_length=255, blank=True)
    content = models.TextField(help_text="Note content (supports markdown)")
    note_type = models.CharField(max_length=15, choices=NOTE_TYPE_CHOICES, default='general')
    
    # User info  
    author = models.CharField(max_length=100, help_text="Username of note author")
    
    # Organization
    tags = models.JSONField(default=list, blank=True)
    color = models.CharField(max_length=7, default='#ffeb3b', help_text="Hex color for note display")
    
    # Status for todo-type notes
    is_completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.CharField(max_length=100, blank=True)
    
    # Reminders
    reminder_at = models.DateTimeField(null=True, blank=True)
    is_reminded = models.BooleanField(default=False)
    
    # Metadata
    metadata = models.JSONField(default=dict, blank=True)
    
    objects = NoteManager()
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            # Individual foreign key indexes for performance
            models.Index(fields=['versioned_entity']),
            models.Index(fields=['version']),
            models.Index(fields=['container']),
            models.Index(fields=['container_version']),
            # Functional indexes
            models.Index(fields=['author']),
            models.Index(fields=['note_type']),
            models.Index(fields=['is_completed']),
            models.Index(fields=['reminder_at']),
        ]
        constraints = [
            # Ensure exactly one foreign key is set
            models.CheckConstraint(
                check=(
                    models.Q(versioned_entity__isnull=False, version__isnull=True, container__isnull=True, container_version__isnull=True) |
                    models.Q(versioned_entity__isnull=True, version__isnull=False, container__isnull=True, container_version__isnull=True) |
                    models.Q(versioned_entity__isnull=True, version__isnull=True, container__isnull=False, container_version__isnull=True) |
                    models.Q(versioned_entity__isnull=True, version__isnull=True, container__isnull=True, container_version__isnull=False)
                ),
                name='note_single_parent_constraint'
            )
        ]
    
    def __str__(self):
        title = self.title or (self.content[:50] + "..." if len(self.content) > 50 else self.content)
        return f"Note by {self.author}: {title}"
    
    def get_attached_object(self):
        """Get the object this note is attached to."""
        if self.versioned_entity:
            return self.versioned_entity
        elif self.version:
            return self.version
        elif self.container:
            return self.container
        elif self.container_version:
            return self.container_version
        return None
    
    def get_attached_object_type(self):
        """Get the type name of the attached object."""
        obj = self.get_attached_object()
        if obj:
            return obj._meta.model_name
        return None
    
    def complete_todo(self, completed_by):
        """Mark a todo note as completed."""
        if self.note_type == 'todo':
            self.is_completed = True
            self.completed_at = timezone.now()
            self.completed_by = completed_by
            self.save(update_fields=['is_completed', 'completed_at', 'completed_by'])
    
    def set_reminder(self, reminder_datetime):
        """Set a reminder for this note."""
        self.reminder_at = reminder_datetime
        self.is_reminded = False
        self.save(update_fields=['reminder_at', 'is_reminded'])
    
    def clean(self):
        """Validate that exactly one foreign key is set."""
        from django.core.exceptions import ValidationError
        fk_fields = [self.versioned_entity, self.version, self.container, self.container_version]
        non_null_count = sum(1 for field in fk_fields if field is not None)
        
        if non_null_count == 0:
            raise ValidationError("Note must be attached to exactly one object.")
        elif non_null_count > 1:
            raise ValidationError("Note can only be attached to one object at a time.")
