# Test Configuration and Environment Setup

## Environment Variables for Testing

```bash
# Core Django settings
export DJANGO_SETTINGS_MODULE=nexus8.settings
export DEBUG=True
export TEST_DATABASE=nexus8_test

# Performance test settings
export PERFORMANCE_ITERATIONS=100
export SCALE_TEST_SIZE=10000
export ENABLE_QUERY_LOGGING=False  # Disable for accurate timing

# CG Production test settings
export CG_TEST_PROJECT_COUNT=10
export CG_TEST_ASSET_COUNT=1000
export CG_TEST_VERSION_COUNT=5000

# API test settings
export API_TEST_BASE_URL=http://localhost:8000
export API_TEST_TIMEOUT=30
export API_TEST_CONCURRENT_USERS=10
```

## Test Database Setup

### PostgreSQL Test Database:
```sql
-- Create test database
CREATE DATABASE nexus8_test;
CREATE USER nexus8_test_user WITH PASSWORD 'test_password';
GRANT ALL PRIVILEGES ON DATABASE nexus8_test TO nexus8_test_user;
```

### Django Test Settings:
```python
# nexus8/test_settings.py
from .settings import *

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'nexus8_test',
        'USER': 'nexus8_test_user',
        'PASSWORD': 'test_password',
        'HOST': 'localhost',
        'PORT': '5432',
        'TEST': {
            'NAME': 'nexus8_test_db',
        }
    }
}

# Disable migrations for faster testing
class DisableMigrations:
    def __contains__(self, item):
        return True
    def __getitem__(self, item):
        return None

MIGRATION_MODULES = DisableMigrations()

# Test-specific logging
LOGGING['loggers']['django.db.backends']['level'] = 'WARNING'
```

## Performance Test Configuration

### System Requirements:
- **RAM**: Minimum 8GB, recommended 16GB+
- **CPU**: Multi-core processor for concurrent testing
- **Storage**: SSD recommended for database I/O
- **Network**: Stable connection for API tests

### Performance Baselines:
```python
# Expected performance targets
PERFORMANCE_TARGETS = {
    'hierarchy_query_ms': 5.0,        # Current: 2.6ms
    'api_response_ms': 100.0,         # Standard API response
    'bulk_operation_ms': 50.0,        # Per 100 items
    'serialization_ms': 10.0,         # JSON serialization
    'database_connection_ms': 2.0,    # Connection establishment
}

# Scale test targets
SCALE_TARGETS = {
    'max_containers': 10000,
    'max_hierarchy_depth': 10,
    'max_concurrent_users': 100,
    'max_database_size_gb': 10,
}
```

## CI/CD Integration

### GitHub Actions Workflow:
```yaml
name: Nexus8 Test Suite
on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:13
        env:
          POSTGRES_DB: nexus8_test
          POSTGRES_USER: nexus8_test_user
          POSTGRES_PASSWORD: test_password
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
    - uses: actions/checkout@v2
    
    - name: Set up Python 3.9
      uses: actions/setup-python@v2
      with:
        python-version: 3.9
    
    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        pip install -r requirements.txt
        pip install -r requirements-test.txt
    
    - name: Set up test environment
      run: |
        export DJANGO_SETTINGS_MODULE=nexus8.test_settings
        python manage.py migrate
        python manage.py collectstatic --noinput
    
    - name: Run test suite
      run: |
        python nexus8/tests/run_tests.py --category integration
        python nexus8/tests/run_tests.py --category api
        python nexus8/tests/run_tests.py --benchmark
    
    - name: Upload test results
      uses: actions/upload-artifact@v2
      if: always()
      with:
        name: test-results
        path: test-results/
```

### Docker Test Environment:
```dockerfile
# Dockerfile.test
FROM python:3.9-slim

RUN apt-get update && apt-get install -y \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-test.txt ./
RUN pip install -r requirements.txt -r requirements-test.txt

COPY . .

ENV DJANGO_SETTINGS_MODULE=nexus8.test_settings
ENV PYTHONPATH=/app

CMD ["python", "nexus8/tests/run_tests.py"]
```

### Docker Compose for Testing:
```yaml
version: '3.8'
services:
  db:
    image: postgres:13
    environment:
      POSTGRES_DB: nexus8_test
      POSTGRES_USER: nexus8_test_user
      POSTGRES_PASSWORD: test_password
    volumes:
      - postgres_test_data:/var/lib/postgresql/data

  nexus8-tests:
    build:
      context: .
      dockerfile: Dockerfile.test
    depends_on:
      - db
    environment:
      - DATABASE_URL=postgresql://nexus8_test_user:test_password@db:5432/nexus8_test
      - DJANGO_SETTINGS_MODULE=nexus8.test_settings
    volumes:
      - ./test-results:/app/test-results

volumes:
  postgres_test_data:
```

## Test Data Management

### Fixtures for Testing:
```python
# nexus8/fixtures/test_data.py
import json
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from containers.models import Container

class Command(BaseCommand):
    help = 'Load test data for comprehensive testing'
    
    def handle(self, *args, **options):
        # Create test users
        test_users = [
            {'username': 'animator1', 'email': 'animator1@studio.com'},
            {'username': 'lighter1', 'email': 'lighter1@studio.com'},
            {'username': 'director1', 'email': 'director1@studio.com'},
        ]
        
        for user_data in test_users:
            User.objects.get_or_create(**user_data)
        
        # Create test containers for CG production
        test_projects = [
            'EPIC_FILM_2025',
            'SHORT_FILM_DEMO',
            'COMMERCIAL_SPOT_01'
        ]
        
        for project in test_projects:
            # Create project containers and hierarchies
            self.create_project_structure(project)
    
    def create_project_structure(self, project_name):
        # Implementation for creating test project structure
        pass
```

### Test Data Cleanup:
```python
# nexus8/tests/utils/cleanup.py
import os
from django.core.management import call_command
from django.test.utils import override_settings

class TestDataManager:
    @staticmethod
    def setup_test_data():
        """Set up fresh test data."""
        call_command('loaddata', 'test_fixtures.json')
    
    @staticmethod
    def cleanup_test_data():
        """Clean up test data after tests."""
        # Clean up test files, database entries, etc.
        pass
    
    @staticmethod
    def reset_database():
        """Reset test database to clean state."""
        call_command('flush', '--noinput')
        call_command('migrate')
```

## Monitoring and Reporting

### Test Metrics Collection:
```python
# nexus8/tests/utils/metrics.py
import psutil
import time
from contextlib import contextmanager

@contextmanager
def performance_monitor():
    """Context manager to monitor test performance."""
    start_time = time.time()
    start_memory = psutil.virtual_memory().used
    start_cpu = psutil.cpu_percent()
    
    yield
    
    end_time = time.time()
    end_memory = psutil.virtual_memory().used
    end_cpu = psutil.cpu_percent()
    
    metrics = {
        'duration': end_time - start_time,
        'memory_delta': end_memory - start_memory,
        'avg_cpu': (start_cpu + end_cpu) / 2
    }
    
    return metrics
```

### Test Report Generation:
```python
# nexus8/tests/utils/reporting.py
import json
from datetime import datetime

class TestReporter:
    def __init__(self):
        self.report_data = {
            'timestamp': datetime.now().isoformat(),
            'environment': self.get_environment_info(),
            'test_results': {}
        }
    
    def add_test_result(self, category, test_name, result):
        if category not in self.report_data['test_results']:
            self.report_data['test_results'][category] = []
        
        self.report_data['test_results'][category].append({
            'test': test_name,
            'status': result['status'],
            'duration': result['duration'],
            'metrics': result.get('metrics', {})
        })
    
    def generate_html_report(self, output_path):
        """Generate HTML test report."""
        # Implementation for HTML report generation
        pass
    
    def generate_json_report(self, output_path):
        """Generate JSON test report."""
        with open(output_path, 'w') as f:
            json.dump(self.report_data, f, indent=2)
```

This configuration provides comprehensive test environment setup with proper isolation, performance monitoring, and CI/CD integration for the Nexus8 test suite.
