"""
Structured logging middleware for Nexus8 CG production system.

This middleware provides comprehensive request/response logging with
CG production specific context and performance monitoring.
"""
import logging
import time
import uuid
from django.utils.deprecation import MiddlewareMixin
from django.contrib.auth.models import AnonymousUser

# Create specialized loggers
request_logger = logging.getLogger('nexus8.requests')
performance_logger = logging.getLogger('nexus8.performance')
cg_logger = logging.getLogger('nexus8.cg_operations')

class RequestIDMiddleware(MiddlewareMixin):
    """Add unique request ID for tracing across logs."""
    
    def process_request(self, request):
        """Add unique ID to each request."""
        request.id = str(uuid.uuid4())[:8]  # 8-character ID for logs
        return None

class StructuredLoggingMiddleware(MiddlewareMixin):
    """
    Comprehensive structured logging for all requests.
    
    Logs:
    - Request initiation with full context
    - Response completion with performance metrics  
    - Exceptions with error details
    - CG production specific context
    """
    
    def process_request(self, request):
        """Log request start with full context."""
        request._log_start_time = time.time()
        
        # Extract CG production context from headers
        context = self._extract_cg_context(request)
        
        # Log request initiation
        request_logger.info("Request started", extra={
            'event_type': 'request_start',
            'request_id': getattr(request, 'id', 'unknown'),
            'method': request.method,
            'path': request.path,
            'full_path': request.get_full_path(),
            'user_id': self._get_user_id(request),
            'username': self._get_username(request),
            'ip_address': self._get_client_ip(request),
            'user_agent': request.META.get('HTTP_USER_AGENT', '')[:200],
            'content_type': request.content_type,
            'content_length': int(request.META.get('CONTENT_LENGTH', 0)),
            **context  # CG production context
        })
        
        return None
    
    def process_response(self, request, response):
        """Log response with performance metrics."""
        if not hasattr(request, '_log_start_time'):
            return response
            
        duration = time.time() - request._log_start_time
        
        # Base response context
        response_context = {
            'event_type': 'request_complete',
            'request_id': getattr(request, 'id', 'unknown'),
            'method': request.method,
            'path': request.path,
            'status_code': response.status_code,
            'duration_ms': round(duration * 1000, 2),
            'response_size': len(response.content) if hasattr(response, 'content') else 0,
            'user_id': self._get_user_id(request),
        }
        
        # Add CG context
        response_context.update(self._extract_cg_context(request))
        
        # Log based on status and performance
        if response.status_code >= 500:
            request_logger.error("Server error response", extra=response_context)
        elif response.status_code >= 400:
            request_logger.warning("Client error response", extra=response_context)
        elif duration > 5.0:  # Slow request threshold for CG operations
            performance_logger.warning("Slow request", extra={
                **response_context,
                'performance_issue': 'slow_response',
                'threshold_ms': 5000,
            })
        else:
            request_logger.info("Request completed", extra=response_context)
        
        # Always log performance metrics for analysis
        performance_logger.info("Request performance", extra={
            'event_type': 'performance_metric',
            'request_id': getattr(request, 'id', 'unknown'),
            'duration_ms': round(duration * 1000, 2),
            'method': request.method,
            'path': request.path,
            'status_code': response.status_code,
        })
        
        return response
    
    def process_exception(self, request, exception):
        """Log exceptions with full context."""
        duration = time.time() - getattr(request, '_log_start_time', time.time())
        
        request_logger.error("Request exception", extra={
            'event_type': 'request_exception',
            'request_id': getattr(request, 'id', 'unknown'),
            'method': request.method,
            'path': request.path,
            'exception_type': type(exception).__name__,
            'exception_message': str(exception)[:500],  # Limit message length
            'duration_ms': round(duration * 1000, 2),
            'user_id': self._get_user_id(request),
            **self._extract_cg_context(request)
        })
        
        return None
    
    def _extract_cg_context(self, request):
        """
        Extract CG production context from request headers and parameters.
        
        Expected headers:
        - X-Project-Code: Project identifier (e.g., 'PROJ_EPIC_FILM')
        - X-Department: Department (e.g., 'animation', 'lighting')
        - X-Client-Type: Client type (e.g., 'web', 'mobile', 'desktop')
        - X-Studio-Location: Studio location for distributed workflows
        - X-Render-Farm-ID: Render farm identifier for render operations
        """
        return {
            'project_code': request.headers.get('X-Project-Code', 'unknown'),
            'department': request.headers.get('X-Department', 'unknown'),
            'client_type': request.headers.get('X-Client-Type', 'web'),
            'studio_location': request.headers.get('X-Studio-Location', 'main'),
            'render_farm_id': request.headers.get('X-Render-Farm-ID'),
            'asset_type': request.GET.get('asset_type'),
            'sequence': request.GET.get('sequence'),
            'shot': request.GET.get('shot'),
            'version': request.GET.get('version'),
        }
    
    def _get_user_id(self, request):
        """Safely get user ID."""
        if hasattr(request, 'user') and not isinstance(request.user, AnonymousUser):
            return request.user.id
        return None
    
    def _get_username(self, request):
        """Safely get username."""
        if hasattr(request, 'user') and not isinstance(request.user, AnonymousUser):
            return request.user.username
        return 'anonymous'
    
    def _get_client_ip(self, request):
        """Extract client IP address, handling proxies."""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            return x_forwarded_for.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR', 'unknown')
