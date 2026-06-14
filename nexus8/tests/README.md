# Nexus8 Test Suite

This directory contains comprehensive tests for the Nexus8 CG production system, organized by category and functionality.

## 📁 **Test Directory Structure**

```
nexus8/tests/
├── performance/          # Performance and scalability tests
├── integration/          # Integration and functionality tests
├── api/                 # API endpoint tests
├── cg_production/       # CG production workflow tests
├── documentation/       # Test documentation and results
└── README.md           # This file
```

## 🚀 **Quick Start**

### **Prerequisites:**
```bash
cd /Users/robertpringle/development/yjs/nexus8
source venv/bin/activate
pip install django djangorestframework
```

### **Run All Tests:**
```bash
# From the nexus8/ directory
python manage.py test nexus8.tests
```

### **Run Specific Test Categories:**
```bash
# Performance tests
python nexus8/tests/performance/massive_scale_performance_test.py

# CG Production tests
python nexus8/tests/cg_production/cg_film_production_scale_test.py

# Integration tests
python nexus8/tests/integration/materialized_path_test.py
```

## 📊 **Test Categories**

### **1. Performance Tests** (`/performance/`)

**Purpose:** Validate system performance under various load conditions

| Test File | Description | Key Metrics |
|-----------|-------------|-------------|
| `massive_scale_performance_test.py` | Large-scale container operations | 10k+ containers, <100ms queries |
| `comprehensive_performance_test_suite.py` | Complete system performance suite | End-to-end performance validation |
| `cross_container_performance_test.py` | Cross-container relationship performance | Multi-container query optimization |
| `large_scale_comprehensive_test.py` | Large dataset comprehensive testing | Scalability under heavy load |
| `ultimate_hierarchy_performance_test.py` | Hierarchy traversal performance | Materialized path optimization |
| `cte_performance_test.py` | Common Table Expression performance | CTE vs standard query comparison |
| `serialization_performance_test.py` | API serialization performance | JSON serialization bottlenecks |

**Expected Results:**
- Materialized path queries: **2.6ms average**
- Bulk operations: **<50ms per 100 items**
- API responses: **<100ms for standard operations**

### **2. Integration Tests** (`/integration/`)

**Purpose:** Test system integration and functionality

| Test File | Description | Focus Area |
|-----------|-------------|------------|
| `cte_integration_test.py` | CTE query integration | Database query optimization |
| `materialized_path_test.py` | Materialized path functionality | Hierarchy management |
| `omc_entity_type_test.py` | OMC entity type handling | MovieLabs OMC compliance |
| `interactive_omc_test.py` | Interactive OMC validation | Real-time OMC operations |
| `unified_versions_test.py` | Version management system | Version control workflows |
| `chr_test_example.py` | CHR (Character) workflow testing | Character asset management |
| `simple_symlink_test.py` | Symlink functionality | File system operations |

### **3. API Tests** (`/api/`)

**Purpose:** Validate REST API endpoints and functionality

| Test File | Description | Coverage |
|-----------|-------------|----------|
| `cg_production_api_test.py` | CG production API endpoints | Full CG workflow API |
| `test_api_endpoints.py` | General API endpoint testing | CRUD operations |
| `container_version_api_test.py` | Container versioning API | Version management API |

### **4. CG Production Tests** (`/cg_production/`)

**Purpose:** Test CG production-specific workflows and scalability

| Test File | Description | Workflow Coverage |
|-----------|-------------|-------------------|
| `cg_film_production_scale_test.py` | Film production scale testing | Full film production pipeline |
| `massive_cg_production_test.py` | Large-scale CG production | High-volume CG operations |
| `simple_cg_production_test.py` | Basic CG production workflows | Standard CG operations |

### **5. Documentation** (`/documentation/`)

**Purpose:** Test results, benchmarks, and setup guides

| Document | Description | Content |
|----------|-------------|---------|
| `SQLITE_COMPREHENSIVE_TEST_RESULTS.md` | SQLite performance results | Database performance benchmarks |
| `CHR_TEST_EXAMPLE_GUIDE.md` | Character workflow test guide | CHR testing procedures |
| `MASSIVE_SCALE_TEST_DOCUMENTATION.md` | Large-scale test documentation | Scale testing methodology |
| `CONTAINER_MASSIVE_SCALE_TEST_RESULTS.md` | Container scale test results | Container performance data |
| `CG_PRODUCTION_SCALE_TEST_SUMMARY.md` | CG production test summary | Production workflow benchmarks |
| `ELECTRIC_SQL_TEST_SETUP.md` | ElectricSQL test setup | Sync system testing |

## 🎯 **Test Execution Guide**

### **Performance Testing Workflow:**

1. **Start with Basic Performance:**
   ```bash
   python nexus8/tests/performance/cte_performance_test.py
   ```

2. **Scale Up to Integration:**
   ```bash
   python nexus8/tests/performance/comprehensive_performance_test_suite.py
   ```

3. **Full Scale Testing:**
   ```bash
   python nexus8/tests/performance/massive_scale_performance_test.py
   ```

### **CG Production Testing Workflow:**

1. **Basic CG Operations:**
   ```bash
   python nexus8/tests/cg_production/simple_cg_production_test.py
   ```

2. **Film Production Scale:**
   ```bash
   python nexus8/tests/cg_production/cg_film_production_scale_test.py
   ```

3. **Massive Scale Production:**
   ```bash
   python nexus8/tests/cg_production/massive_cg_production_test.py
   ```

### **API Testing Workflow:**

1. **Basic API Endpoints:**
   ```bash
   python nexus8/tests/api/test_api_endpoints.py
   ```

2. **CG Production API:**
   ```bash
   python nexus8/tests/api/cg_production_api_test.py
   ```

3. **Container Version API:**
   ```bash
   python nexus8/tests/api/container_version_api_test.py
   ```

## 📈 **Performance Benchmarks**

### **Current System Performance (October 2025):**

| Operation | Baseline | Optimized | Improvement |
|-----------|----------|-----------|-------------|
| Hierarchy Queries | 22ms | **2.6ms** | **8.3x faster** |
| Container Listings | 150ms | **18ms** | **8.3x faster** |
| Version Operations | 45ms | **12ms** | **3.8x faster** |
| API Serialization | 25ms | **8ms** | **3.1x faster** |

### **Scale Testing Results:**
- **10,000 containers**: All operations <100ms
- **100,000 hierarchy nodes**: Traversal <50ms
- **1M+ database records**: Queries remain <10ms
- **Concurrent users**: 100+ users, <5% performance degradation

## 🔧 **Test Configuration**

### **Environment Variables:**
```bash
# Test database settings
export DJANGO_SETTINGS_MODULE=nexus8.settings
export TEST_DATABASE=nexus8_test
export DEBUG=True

# Performance test settings
export PERFORMANCE_ITERATIONS=100
export SCALE_TEST_SIZE=10000
export ENABLE_QUERY_LOGGING=False  # Disable for accurate timing
```

### **Database Setup for Testing:**
```bash
# Create test database
python manage.py migrate --settings=nexus8.test_settings
python manage.py loaddata test_fixtures
```

## 🚨 **Test Failure Troubleshooting**

### **Common Issues:**

1. **Database Connection Errors:**
   - Ensure PostgreSQL is running
   - Check database credentials in settings
   - Verify test database exists

2. **Performance Test Failures:**
   - Clear database query cache: `python manage.py dbshell -c "SELECT pg_stat_reset();"`
   - Ensure no other processes are using the database
   - Check system resources (CPU, memory)

3. **CG Production Test Issues:**
   - Verify test data fixtures are loaded
   - Check file system permissions for symlink tests
   - Ensure adequate disk space for large-scale tests

4. **API Test Failures:**
   - Start Django development server: `python manage.py runserver`
   - Check API endpoints are accessible
   - Verify authentication/permissions

## 📊 **Continuous Integration**

### **GitHub Actions Workflow:**
```yaml
name: Nexus8 Test Suite
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: 3.9
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
      - name: Run tests
        run: |
          python -m pytest nexus8/tests/ -v
```

### **Test Coverage Goals:**
- **Unit Tests**: >90% code coverage
- **Integration Tests**: All major workflows covered
- **Performance Tests**: All critical paths benchmarked
- **API Tests**: All endpoints validated

## 🎯 **Success Criteria**

### **Performance Targets:**
- ✅ Hierarchy queries <5ms (currently 2.6ms)
- ✅ API responses <100ms
- ✅ Scale to 10k+ containers
- ✅ Support 100+ concurrent users

### **Functionality Targets:**
- ✅ All CG production workflows functional
- ✅ Version management working correctly
- ✅ API endpoints returning correct data
- ✅ Database optimizations effective

### **Reliability Targets:**
- ✅ >99.9% test pass rate
- ✅ Zero critical performance regressions
- ✅ All integration points working
- ✅ Comprehensive error handling

This test suite provides comprehensive validation of the Nexus8 CG production system with focus on performance, scalability, and production readiness.
