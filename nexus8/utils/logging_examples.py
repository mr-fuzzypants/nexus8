"""
Example usage of structured logging in CG production views.

This demonstrates how to integrate the structured logging system
into your Django views and CG operations.
"""
import logging
from django.shortcuts import get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.utils.decorators import method_decorator
from django.views import View

# Import our custom logging decorators
from ..utils.logging_decorators import (
    log_cg_operation, log_asset_operation, 
    log_render_operation, CGOperationLogger
)

# Standard loggers
logger = logging.getLogger('nexus8.views')
api_logger = logging.getLogger('nexus8.api')

class AssetView(View):
    """Example view showing structured logging integration."""
    
    @method_decorator(login_required)
    def dispatch(self, request, *args, **kwargs):
        return super().dispatch(request, *args, **kwargs)
    
    @log_asset_operation('creation', track_queries=True)
    def post(self, request, project_code):
        """Create a new asset with structured logging."""
        # The decorator automatically logs:
        # - Operation start/completion
        # - Performance metrics
        # - Database query count
        # - User context from request
        # - Any errors that occur
        
        data = request.POST
        
        # Your business logic here
        asset = self._create_asset(
            name=data['name'],
            asset_type=data['type'],
            project_code=project_code,
            user=request.user
        )
        
        # Additional context can be logged manually
        logger.info("Asset created successfully", extra={
            'event_type': 'asset_created',
            'asset_id': asset.id,
            'asset_code': asset.code,
            'project_code': project_code,
            'user_id': request.user.id,
            'metadata': {
                'asset_type': asset.asset_type,
                'initial_version': asset.current_version
            }
        })
        
        return JsonResponse({
            'success': True,
            'asset_id': asset.id,
            'asset_code': asset.code
        })
    
    def _create_asset(self, name, asset_type, project_code, user):
        """Simulate asset creation - replace with your actual model logic."""
        # This would be your actual asset creation logic
        # For example purposes only
        class MockAsset:
            def __init__(self):
                self.id = 12345
                self.code = f"{project_code}_ASSET_{name.upper()}"
                self.name = name
                self.asset_type = asset_type
                self.current_version = "v001"
        
        return MockAsset()

@require_http_methods(["POST"])
@login_required
@log_render_operation('submission', alert_threshold_ms=3000)
def submit_render(request, asset_id):
    """Submit a render job with structured logging."""
    
    # The decorator logs operation details, but we can add more context
    api_logger.info("Render submission started", extra={
        'event_type': 'render_submission',
        'asset_id': asset_id,
        'user_id': request.user.id,
        'render_settings': request.POST.get('settings', {}),
        'priority': request.POST.get('priority', 'normal')
    })
    
    try:
        # Your render submission logic here
        render_job = _submit_render_job(asset_id, request.POST, request.user)
        
        # Log successful submission with job details
        api_logger.info("Render job submitted", extra={
            'event_type': 'render_job_created',
            'render_job_id': render_job['id'],
            'asset_id': asset_id,
            'estimated_duration': render_job['estimated_duration'],
            'queue_position': render_job['queue_position']
        })
        
        return JsonResponse({
            'success': True,
            'job_id': render_job['id'],
            'estimated_duration': render_job['estimated_duration']
        })
        
    except Exception as e:
        # Error logging is handled by decorator, but we can add specific context
        api_logger.error("Render submission failed", extra={
            'event_type': 'render_submission_error',
            'asset_id': asset_id,
            'error_details': str(e),
            'render_settings': request.POST.get('settings', {})
        })
        raise

def _submit_render_job(asset_id, settings, user):
    """Mock render job submission."""
    return {
        'id': 'render_job_67890',
        'estimated_duration': '45m',
        'queue_position': 3
    }

@login_required
def bulk_asset_update(request):
    """Example of manual logging with context manager."""
    
    asset_ids = request.POST.getlist('asset_ids')
    update_data = request.POST.dict()
    
    # Use context manager for complex operations that need custom logging
    with CGOperationLogger('bulk_asset_update', 
                          user_id=request.user.id,
                          asset_count=len(asset_ids)) as op_logger:
        
        updated_assets = []
        failed_updates = []
        
        for asset_id in asset_ids:
            try:
                # Your update logic here
                asset = _update_asset(asset_id, update_data)
                updated_assets.append(asset_id)
                
            except Exception as e:
                failed_updates.append({
                    'asset_id': asset_id,
                    'error': str(e)
                })
        
        # Add final results to the operation log
        op_logger.add_context({
            'successful_updates': len(updated_assets),
            'failed_updates': len(failed_updates),
            'success_rate': len(updated_assets) / len(asset_ids) * 100
        })
        
        # Log individual failures
        for failure in failed_updates:
            logger.error("Asset update failed", extra={
                'event_type': 'asset_update_failed',
                'asset_id': failure['asset_id'],
                'error_message': failure['error'],
                'bulk_operation_id': id(op_logger)  # Link to bulk operation
            })
    
    return JsonResponse({
        'success': len(failed_updates) == 0,
        'updated_count': len(updated_assets),
        'failed_count': len(failed_updates),
        'failures': failed_updates
    })

def _update_asset(asset_id, update_data):
    """Mock asset update."""
    # Your actual update logic would go here
    return f"updated_asset_{asset_id}"

# Example of using structured logging in a model method
class CGAsset:
    """Example model showing structured logging integration."""
    
    def __init__(self, id, code, name):
        self.id = id
        self.code = code
        self.name = name
        self.logger = logging.getLogger(f'nexus8.models.{self.__class__.__name__}')
    
    @log_cg_operation('version_creation', track_queries=True, alert_threshold_ms=500)
    def create_version(self, version_number, user, **metadata):
        """Create a new version of this asset."""
        
        # The decorator handles the operation logging
        # This logs with automatic context extraction
        
        self.logger.info("Creating asset version", extra={
            'event_type': 'version_creation_start',
            'asset_id': self.id,
            'asset_code': self.code,
            'version_number': version_number,
            'metadata': metadata
        })
        
        # Your version creation logic here
        version = self._create_version_record(version_number, user, metadata)
        
        self.logger.info("Asset version created", extra={
            'event_type': 'version_created',
            'asset_id': self.id,
            'version_id': version['id'],
            'version_number': version_number,
            'file_count': len(version.get('files', [])),
            'total_size_mb': version.get('total_size_mb', 0)
        })
        
        return version
    
    def _create_version_record(self, version_number, user, metadata):
        """Mock version creation."""
        return {
            'id': f'version_{version_number}_{self.id}',
            'files': ['texture.exr', 'geometry.abc'],
            'total_size_mb': 156.7
        }

# Example middleware for request-level logging
class CGRequestLoggingMiddleware:
    """Additional middleware for CG-specific request logging."""
    
    def __init__(self, get_response):
        self.get_response = get_response
        self.logger = logging.getLogger('nexus8.requests')
    
    def __call__(self, request):
        # Log CG-specific request information
        if self._is_cg_request(request):
            self.logger.info("CG API request", extra={
                'event_type': 'cg_api_request',
                'path': request.path,
                'method': request.method,
                'user_id': request.user.id if request.user.is_authenticated else None,
                'project_code': self._extract_project_code(request),
                'asset_id': request.GET.get('asset_id') or request.POST.get('asset_id'),
                'version': request.GET.get('version') or request.POST.get('version'),
                'user_agent': request.META.get('HTTP_USER_AGENT', '')
            })
        
        response = self.get_response(request)
        
        # Log response for CG operations
        if self._is_cg_request(request):
            self.logger.info("CG API response", extra={
                'event_type': 'cg_api_response',
                'path': request.path,
                'status_code': response.status_code,
                'response_size': len(response.content) if hasattr(response, 'content') else 0
            })
        
        return response
    
    def _is_cg_request(self, request):
        """Check if this is a CG production related request."""
        cg_paths = ['/api/assets/', '/api/renders/', '/api/versions/', '/api/sync/']
        return any(request.path.startswith(path) for path in cg_paths)
    
    def _extract_project_code(self, request):
        """Extract project code from URL or parameters."""
        # Look for project code in URL path
        path_parts = request.path.split('/')
        if 'projects' in path_parts:
            try:
                project_index = path_parts.index('projects')
                return path_parts[project_index + 1]
            except (IndexError, ValueError):
                pass
        
        # Look in query parameters
        return request.GET.get('project') or request.POST.get('project')
