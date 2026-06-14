#!/usr/bin/env python
"""
Task Model Demo and Test
Demonstrates the hierarchical Task model functionality with polymorphic attachments.
"""

import os
import sys
import django
from datetime import datetime, timedelta

# Setup Django
sys.path.append('/Users/robertpringle/development/yjs/nexus8/nexus8')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
django.setup()

from trackables.models import (
    VersionedEntity, Version, Container, Task, 
    create_task_hierarchy, bulk_update_task_status
)
from django.utils import timezone


def demo_task_system():
    """Demonstrate the Task system functionality."""
    print("🎯 Task Management System Demo")
    print("=" * 50)
    
    # 1. Create some test entities
    print("\n1. Creating test entities...")
    
    # Create a character entity
    character = VersionedEntity.objects.create(
        code="chr_hero_001",
        name="Hero Character"
    )
    
    # Create a version
    char_version = Version.objects.create(
        entity=character,
        version_number=1,
        data={
            "status": "in_progress",
            "metadata": {"author": "artist1", "department": "modeling"}
        }
    )
    
    # Create a container (shot)
    shot_container = Container.objects.create(
        code="shot_010",
        name="Opening Shot"
    )
    
    print(f"✓ Created character: {character}")
    print(f"✓ Created version: {char_version}")
    print(f"✓ Created container: {shot_container}")
    
    # 2. Create individual tasks
    print("\n2. Creating individual tasks...")
    
    # Task attached to character entity
    entity_task = Task.objects.create(
        versioned_entity=character,
        title="Character Design Review",
        description="Review character design concepts",
        task_type="review",
        priority="high",
        assigned_to="supervisor@studio.com",
        due_date=timezone.now() + timedelta(days=3),
        tags=["design", "character", "review"]
    )
    
    # Task attached to specific version
    version_task = Task.objects.create(
        version=char_version,
        title="Fix Model Topology",
        description="Clean up geometry topology issues",
        task_type="bug_fix",
        priority="urgent",
        assigned_to="modeler@studio.com",
        estimated_hours=4.5
    )
    
    # Task attached to container
    container_task = Task.objects.create(
        container=shot_container,
        title="Shot Layout Approval",
        description="Get director approval on shot layout",
        task_type="approval",
        priority="critical",
        assigned_to="director@studio.com"
    )
    
    print(f"✓ Created entity task: {entity_task}")
    print(f"✓ Created version task: {version_task}")
    print(f"✓ Created container task: {container_task}")
    
    # 3. Create hierarchical task structure
    print("\n3. Creating hierarchical task structure...")
    
    task_hierarchy = {
        'title': 'Character Animation Pipeline',
        'description': 'Complete character animation for shot',
        'task_type': 'feature',
        'priority': 'high',
        'assigned_to': 'lead_animator@studio.com',
        'due_date': timezone.now() + timedelta(days=14),
        'subtasks': [
            {
                'title': 'Pre-production',
                'description': 'Animation pre-production tasks',
                'subtasks': [
                    {
                        'title': 'Reference Gathering',
                        'description': 'Collect animation reference materials',
                        'assigned_to': 'animator1@studio.com',
                        'estimated_hours': 2.0
                    },
                    {
                        'title': 'Blocking Plan',
                        'description': 'Plan key poses and timing',
                        'assigned_to': 'animator1@studio.com',
                        'estimated_hours': 4.0
                    }
                ]
            },
            {
                'title': 'Animation Production',
                'description': 'Main animation work',
                'subtasks': [
                    {
                        'title': 'Rough Animation',
                        'description': 'Block out basic animation',
                        'assigned_to': 'animator2@studio.com',
                        'estimated_hours': 16.0
                    },
                    {
                        'title': 'Polish Pass',
                        'description': 'Refine and polish animation',
                        'assigned_to': 'senior_animator@studio.com',
                        'estimated_hours': 12.0
                    }
                ]
            },
            {
                'title': 'Final Review',
                'description': 'Review and approval process',
                'task_type': 'review',
                'assigned_to': 'animation_supervisor@studio.com'
            }
        ]
    }
    
    # Create the task hierarchy attached to the container
    root_tasks = create_task_hierarchy(shot_container, task_hierarchy)
    root_task = root_tasks[0]
    
    print(f"✓ Created hierarchical task: {root_task}")
    print(f"  - Hierarchy path: {' > '.join(root_task.get_hierarchy_path())}")
    print(f"  - Hierarchy level: {root_task.get_hierarchy_level()}")
    
    # 4. Demonstrate task queries
    print("\n4. Demonstrating task queries...")
    
    # Get all tasks for the character
    char_tasks = Task.objects.for_entity(character)
    print(f"✓ Character tasks: {char_tasks.count()}")
    
    # Get all tasks for the container
    container_tasks = Task.objects.for_container(shot_container)
    print(f"✓ Container tasks: {container_tasks.count()}")
    
    # Get root tasks only
    root_tasks_query = Task.objects.root_tasks()
    print(f"✓ Root tasks: {root_tasks_query.count()}")
    
    # Get tasks by status
    pending_tasks = Task.objects.by_status('pending')
    print(f"✓ Pending tasks: {pending_tasks.count()}")
    
    # Get tasks by priority
    high_priority = Task.objects.by_priority('high')
    print(f"✓ High priority tasks: {high_priority.count()}")
    
    # Get active tasks
    active_tasks = Task.objects.active_tasks()
    print(f"✓ Active tasks: {active_tasks.count()}")
    
    # 5. Demonstrate task hierarchy methods
    print("\n5. Demonstrating task hierarchy methods...")
    
    # Get all subtasks recursively
    all_subtasks = root_task.get_all_subtasks()
    print(f"✓ All subtasks under root: {len(all_subtasks)}")
    
    # Show hierarchy for each subtask
    for task in all_subtasks[:5]:  # Show first 5
        path = ' > '.join(task.get_hierarchy_path())
        level = task.get_hierarchy_level()
        print(f"  - Level {level}: {path}")
    
    # 6. Demonstrate task completion workflow
    print("\n6. Demonstrating task completion workflow...")
    
    # Find a leaf task (no subtasks)
    leaf_task = None
    for task in all_subtasks:
        if not task.subtasks.exists():
            leaf_task = task
            break
    
    if leaf_task:
        print(f"✓ Found leaf task: {leaf_task.title}")
        print(f"  - Can be completed: {leaf_task.can_be_completed()}")
        print(f"  - Completion percentage: {leaf_task.get_completion_percentage()}%")
        
        # Complete the leaf task
        leaf_task.mark_completed()
        print(f"  - Task completed at: {leaf_task.completion_date}")
        
        # Check parent completion percentage
        if leaf_task.parent_task:
            parent = leaf_task.parent_task
            print(f"  - Parent completion: {parent.get_completion_percentage():.1f}%")
    
    # 7. Demonstrate bulk operations
    print("\n7. Demonstrating bulk operations...")
    
    # Create multiple tasks using bulk creation
    bulk_tasks_data = [
        {
            'versioned_entity': character,
            'title': f'Review Task {i}',
            'description': f'Review task number {i}',
            'task_type': 'review',
            'assigned_to': f'reviewer{i}@studio.com'
        }
        for i in range(1, 6)
    ]
    
    bulk_created = Task.objects.bulk_create_optimized(bulk_tasks_data)
    print(f"✓ Bulk created {len(bulk_created)} tasks")
    
    # Bulk update task status
    task_ids = [task.id for task in bulk_created]
    updated_count = bulk_update_task_status(task_ids, 'in_progress', 'new_assignee@studio.com')
    print(f"✓ Bulk updated {updated_count} tasks to 'in_progress'")
    
    # 8. Demonstrate polymorphic attachment validation
    print("\n8. Demonstrating validation...")
    
    try:
        # Try to create task with multiple attachments (should fail)
        invalid_task = Task(
            versioned_entity=character,
            version=char_version,  # Can't attach to both
            title="Invalid Task"
        )
        invalid_task.save()
    except Exception as e:
        print(f"✓ Validation works: {e}")
    
    try:
        # Try to create task with no attachment (should fail)
        invalid_task2 = Task(
            title="No Attachment Task"
        )
        invalid_task2.save()
    except Exception as e:
        print(f"✓ Validation works: {e}")
    
    # 9. Show final statistics
    print("\n9. Final statistics...")
    print(f"✓ Total tasks: {Task.objects.count()}")
    print(f"✓ Tasks by status:")
    for status, label in Task.STATUS_CHOICES:
        count = Task.objects.filter(status=status).count()
        if count > 0:
            print(f"   - {label}: {count}")
    
    print(f"✓ Tasks by priority:")
    for priority, label in Task.PRIORITY_CHOICES:
        count = Task.objects.filter(priority=priority).count()
        if count > 0:
            print(f"   - {label}: {count}")
    
    print(f"✓ Tasks by type:")
    for task_type, label in Task.TASK_TYPE_CHOICES:
        count = Task.objects.filter(task_type=task_type).count()
        if count > 0:
            print(f"   - {label}: {count}")
    
    print("\n✅ Task Management System Demo Complete!")
    print("All functionality working as expected.")


if __name__ == "__main__":
    demo_task_system()
