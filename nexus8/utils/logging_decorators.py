"""
Logging decorators for CG production operations in Nexus8.

These decorators provide structured logging for various CG operations
with performance tracking, database query monitoring, and alerting.
"""
import logging
import time
import functools
from typing import Any, Callable, Dict, Optional
from django.db import connection
from django.contrib.auth.models import AnonymousUser

# Specialized loggers
cg_logger = logging.getLogger('nexus8.cg_operations')
performance_logger = logging.getLogger('nexus8.performance')

def log_cg_operation(
    operation_type: str,
    track_performance: bool = True,
    track_queries: bool = False,
    alert_threshold_ms: Optional[float] = None
):
    """
    Decorator for logging CG production operations with structured data.
    
    Args:
        operation_type: Type of operation (e.g., 'asset_creation', 'version_update')
        track_performance: Whether to log performance metrics
        track_queries: Whether to count database queries
        alert_threshold_ms: Alert if operation takes longer than this (milliseconds)
    
    Usage:
        @log_cg_operation('asset_creation', track_queries=True, alert_threshold_ms=1000)
        def create_asset(self, name, project_code):
            # Your function code here
            pass
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            start_time = time.time()
            initial_queries = len(connection.queries) if track_queries else 0
            
            # Build context from function arguments
            context = {
                'event_type': 'cg_operation',
                'operation_type': operation_type,
                'function_name': func.__name__,
                'module': func.__module__,
                'timestamp': time.time(),
            }
            
            # Extract entity information from arguments
            context.update(_extract_entity_context(args, kwargs))
            
            # Extract user context if available
            context.update(_extract_user_context(args, kwargs))
            
            cg_logger.info(f"Starting {operation_type}", extra=context)
            
            try:
                result = func(*args, **kwargs)
                
                # Calculate metrics
                duration_ms = (time.time() - start_time) * 1000
                query_count = len(connection.queries) - initial_queries if track_queries else 0
                
                # Update context with results
                context.update({
                    'status': 'success',
                    'duration_ms': round(duration_ms, 2),
                    'query_count': query_count,
                })
                
                # Add result information if available
                if hasattr(result, 'id'):
                    context['result_id'] = str(result.id)
                if hasattr(result, 'code'):
                    context['result_code'] = result.code
                if hasattr(result, '__len__'):
                    try:
                        context['result_count'] = len(result)
                    except:
                        pass
                
                # Log completion
                cg_logger.info(f"Completed {operation_type}", extra=context)
                
                # Performance logging
                if track_performance:
                    performance_logger.info(f"Performance: {operation_type}", extra=context)
                
                # Alert on slow operations
                if alert_threshold_ms and duration_ms > alert_threshold_ms:
                    cg_logger.warning(f"Slow {operation_type}", extra={
                        **context,
                        'performance_alert': True,
                        'threshold_ms': alert_threshold_ms,
                    })
                
                return result
                
            except Exception as e:
                # Calculate metrics for failed operation
                duration_ms = (time.time() - start_time) * 1000
                query_count = len(connection.queries) - initial_queries if track_queries else 0
                
                # Update context with error info
                context.update({
                    'status': 'error',
                    'duration_ms': round(duration_ms, 2),
                    'query_count': query_count,
                    'error_type': type(e).__name__,
                    'error_message': str(e)[:500],  # Limit error message length
                })
                
                cg_logger.error(f"Failed {operation_type}", extra=context)
                raise
                
        return wrapper
    return decorator

def _extract_entity_context(args, kwargs) -> Dict[str, Any]:
    """Extract entity information from function arguments."""
    context = {}
    
    # Check first argument for entity information (common pattern: self.method())
    if args and hasattr(args[0], '__dict__'):
        obj = args[0]
        if hasattr(obj, 'code'):
            context['entity_code'] = obj.code
        if hasattr(obj, 'id'):
            context['entity_id'] = str(obj.id)
        if hasattr(obj, '__class__'):
            context['entity_type'] = obj.__class__.__name__.lower()
        if hasattr(obj, 'name'):
            context['entity_name'] = obj.name
    
    # Check keyword arguments for common CG production fields
    for key in ['container_id', 'version_number', 'project_code', 'asset_type', 
                'department', 'sequence', 'shot', 'render_layer']:
        if key in kwargs:
            context[key] = kwargs[key]
    
    return context

def _extract_user_context(args, kwargs) -> Dict[str, Any]:
    """Extract user information from function arguments."""
    context = {}
    
    # Look for user in kwargs
    if 'user' in kwargs:
        user = kwargs['user']
        if user and not isinstance(user, AnonymousUser):
            context['user_id'] = user.id
            context['username'] = user.username
    
    # Look for request object which contains user
    if 'request' in kwargs and hasattr(kwargs['request'], 'user'):
        user = kwargs['request'].user
        if user and not isinstance(user, AnonymousUser):
            context['user_id'] = user.id
            context['username'] = user.username
    
    return context

# Convenience decorators for common CG operations
def log_asset_operation(operation_type: str, **kwargs):
    """
    Decorator specifically for asset operations.
    
    Uses sensible defaults for asset operations:
    - Tracks performance and queries
    - 1 second alert threshold
    """
    return log_cg_operation(
        f"asset_{operation_type}", 
        track_performance=True,
        track_queries=True,
        alert_threshold_ms=1000,  # 1 second threshold for asset ops
        **kwargs
    )

def log_render_operation(operation_type: str, **kwargs):
    """
    Decorator specifically for render operations.
    
    Uses sensible defaults for render operations:
    - Tracks performance (queries optional for render ops)
    - 5 second alert threshold (renders can be slower)
    """
    return log_cg_operation(
        f"render_{operation_type}",
        track_performance=True,
        alert_threshold_ms=5000,  # 5 second threshold for render ops
        **kwargs
    )

def log_sync_operation(operation_type: str, **kwargs):
    """
    Decorator specifically for sync operations.
    
    Uses sensible defaults for sync operations:
    - Tracks performance and queries
    - 2 second alert threshold
    """
    return log_cg_operation(
        f"sync_{operation_type}",
        track_performance=True,
        track_queries=True,
        alert_threshold_ms=2000,  # 2 second threshold for sync ops
        **kwargs
    )

def log_hierarchy_operation(operation_type: str, **kwargs):
    """
    Decorator specifically for hierarchy operations.
    
    Uses sensible defaults for hierarchy operations:
    - Always tracks queries (important for materialized path performance)
    - 500ms alert threshold (hierarchy ops should be fast)
    """
    return log_cg_operation(
        f"hierarchy_{operation_type}",
        track_performance=True,
        track_queries=True,
        alert_threshold_ms=500,  # 500ms threshold - hierarchy should be fast
        **kwargs
    )

# Context manager for manual logging
class CGOperationLogger:
    """
    Context manager for manual CG operation logging.
    
    Usage:
        with CGOperationLogger('custom_operation', user=request.user) as logger:
            # Your operation code here
            result = do_something()
            logger.add_context({'result_count': len(result)})
    """
    
    def __init__(self, operation_type: str, **initial_context):
        self.operation_type = operation_type
        self.context = {
            'event_type': 'cg_operation',
            'operation_type': operation_type,
            'timestamp': time.time(),
            **initial_context
        }
        self.start_time = None
    
    def __enter__(self):
        self.start_time = time.time()
        cg_logger.info(f"Starting {self.operation_type}", extra=self.context)
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        duration_ms = (time.time() - self.start_time) * 1000
        
        self.context.update({
            'duration_ms': round(duration_ms, 2),
            'status': 'error' if exc_type else 'success'
        })
        
        if exc_type:
            self.context.update({
                'error_type': exc_type.__name__,
                'error_message': str(exc_val)[:500]
            })
            cg_logger.error(f"Failed {self.operation_type}", extra=self.context)
        else:
            cg_logger.info(f"Completed {self.operation_type}", extra=self.context)
    
    def add_context(self, additional_context: Dict[str, Any]):
        """Add additional context to the operation log."""
        self.context.update(additional_context)
