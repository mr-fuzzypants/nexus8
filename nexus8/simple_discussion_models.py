# Simple Discussion and Notes Models without GenericForeignKey

from django.db import models
from django.utils import timezone
from .models import Trackable, VersionedEntity, Version, Container, ContainerVersion


class Discussion(Trackable):
    """Simple discussion model with explicit foreign keys."""
    
    # Explicit foreign keys - only one should be set per discussion
    versioned_entity = models.ForeignKey(
        VersionedEntity, 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='discussions'
    )
    version = models.ForeignKey(
        Version, 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='discussions'  
    )
    container = models.ForeignKey(
        Container, 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='discussions'
    )
    container_version = models.ForeignKey(
        ContainerVersion,
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='discussions'
    )
    
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    created_by = models.CharField(max_length=100)
    status = models.CharField(max_length=20, default='open')
    
    def __str__(self):
        return f"Discussion: {self.title}"


class Note(Trackable):
    """Simple note model with explicit foreign keys."""
    
    # Explicit foreign keys - only one should be set per note
    versioned_entity = models.ForeignKey(
        VersionedEntity, 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='notes'
    )
    version = models.ForeignKey(
        Version, 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='notes'
    )
    container = models.ForeignKey(
        Container, 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='notes'
    )
    container_version = models.ForeignKey(
        ContainerVersion,
        on_delete=models.CASCADE, 
        null=True, 
        blank=True,
        related_name='notes'
    )
    
    title = models.CharField(max_length=255, blank=True)
    content = models.TextField()
    author = models.CharField(max_length=100)
    note_type = models.CharField(max_length=20, default='general')
    
    def __str__(self):
        title = self.title or self.content[:50]
        return f"Note: {title}"
