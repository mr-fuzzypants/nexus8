#!/usr/bin/env python
"""
Nexus8 Test Runner - Comprehensive test execution script

This script provides a unified interface for running all Nexus8 tests
with proper categorization, performance monitoring, and reporting.
"""
import os
import sys
import time
import subprocess
import argparse
from pathlib import Path

# Add the parent directory to Python path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

class Nexus8TestRunner:
    def __init__(self):
        self.test_dir = Path(__file__).parent
        self.project_root = self.test_dir.parent
        self.results = {
            'performance': [],
            'integration': [],
            'api': [],
            'cg_production': []
        }
        
    def run_test_file(self, test_file, category):
        """Run a single test file and capture results."""
        print(f"\n🔍 Running {category} test: {test_file.name}")
        print("=" * 60)
        
        start_time = time.time()
        
        try:
            # Change to project root for proper imports
            result = subprocess.run([
                sys.executable, str(test_file)
            ], cwd=self.project_root, capture_output=True, text=True, timeout=300)
            
            duration = time.time() - start_time
            
            if result.returncode == 0:
                print(f"✅ PASSED ({duration:.2f}s)")
                if result.stdout:
                    print("Output:")
                    print(result.stdout[:500] + "..." if len(result.stdout) > 500 else result.stdout)
                
                self.results[category].append({
                    'file': test_file.name,
                    'status': 'PASSED',
                    'duration': duration,
                    'output': result.stdout
                })
            else:
                print(f"❌ FAILED ({duration:.2f}s)")
                if result.stderr:
                    print("Error:")
                    print(result.stderr[:500] + "..." if len(result.stderr) > 500 else result.stderr)
                
                self.results[category].append({
                    'file': test_file.name,
                    'status': 'FAILED',
                    'duration': duration,
                    'error': result.stderr
                })
                
        except subprocess.TimeoutExpired:
            print(f"⏰ TIMEOUT (>300s)")
            self.results[category].append({
                'file': test_file.name,
                'status': 'TIMEOUT',
                'duration': 300,
                'error': 'Test execution timeout'
            })
        except Exception as e:
            print(f"💥 ERROR: {str(e)}")
            self.results[category].append({
                'file': test_file.name,
                'status': 'ERROR',
                'duration': 0,
                'error': str(e)
            })
    
    def run_category_tests(self, category):
        """Run all tests in a specific category."""
        category_dir = self.test_dir / category
        
        if not category_dir.exists():
            print(f"❌ Category directory not found: {category_dir}")
            return
        
        test_files = sorted(category_dir.glob("*.py"))
        if not test_files:
            print(f"⚠️  No test files found in {category}")
            return
        
        print(f"\n🚀 Running {category.upper()} tests ({len(test_files)} files)")
        print("=" * 80)
        
        for test_file in test_files:
            self.run_test_file(test_file, category)
    
    def run_all_tests(self):
        """Run all test categories."""
        print("🎯 NEXUS8 COMPREHENSIVE TEST SUITE")
        print("=" * 80)
        print(f"Test directory: {self.test_dir}")
        print(f"Project root: {self.project_root}")
        
        categories = ['performance', 'integration', 'api', 'cg_production']
        
        for category in categories:
            self.run_category_tests(category)
        
        self.print_summary()
    
    def print_summary(self):
        """Print comprehensive test results summary."""
        print("\n" + "=" * 80)
        print("📊 TEST RESULTS SUMMARY")
        print("=" * 80)
        
        total_tests = 0
        total_passed = 0
        total_failed = 0
        total_errors = 0
        total_timeouts = 0
        total_duration = 0
        
        for category, tests in self.results.items():
            if not tests:
                continue
                
            category_passed = sum(1 for t in tests if t['status'] == 'PASSED')
            category_failed = sum(1 for t in tests if t['status'] == 'FAILED')
            category_errors = sum(1 for t in tests if t['status'] == 'ERROR')
            category_timeouts = sum(1 for t in tests if t['status'] == 'TIMEOUT')
            category_duration = sum(t['duration'] for t in tests)
            
            print(f"\n🔸 {category.upper()} TESTS:")
            print(f"   Total: {len(tests)}")
            print(f"   ✅ Passed: {category_passed}")
            print(f"   ❌ Failed: {category_failed}")
            print(f"   💥 Errors: {category_errors}")
            print(f"   ⏰ Timeouts: {category_timeouts}")
            print(f"   ⏱️  Duration: {category_duration:.2f}s")
            
            # Show failed tests
            failed_tests = [t for t in tests if t['status'] != 'PASSED']
            if failed_tests:
                print(f"   🚨 Failed tests:")
                for test in failed_tests:
                    print(f"      - {test['file']} ({test['status']})")
            
            total_tests += len(tests)
            total_passed += category_passed
            total_failed += category_failed
            total_errors += category_errors
            total_timeouts += category_timeouts
            total_duration += category_duration
        
        print(f"\n🎯 OVERALL RESULTS:")
        print(f"   Total Tests: {total_tests}")
        print(f"   ✅ Passed: {total_passed} ({total_passed/total_tests*100:.1f}%)")
        print(f"   ❌ Failed: {total_failed}")
        print(f"   💥 Errors: {total_errors}")
        print(f"   ⏰ Timeouts: {total_timeouts}")
        print(f"   ⏱️  Total Duration: {total_duration:.2f}s")
        
        # Success rate
        success_rate = total_passed / total_tests * 100 if total_tests > 0 else 0
        if success_rate >= 90:
            print(f"   🎉 SUCCESS RATE: {success_rate:.1f}% - EXCELLENT!")
        elif success_rate >= 75:
            print(f"   ⚠️  SUCCESS RATE: {success_rate:.1f}% - GOOD")
        else:
            print(f"   🚨 SUCCESS RATE: {success_rate:.1f}% - NEEDS ATTENTION")
    
    def run_performance_benchmark(self):
        """Run performance-focused benchmarks with detailed metrics."""
        print("\n🚀 PERFORMANCE BENCHMARK MODE")
        print("=" * 80)
        
        performance_tests = [
            'cte_performance_test.py',
            'comprehensive_performance_test_suite.py',
            'massive_scale_performance_test.py'
        ]
        
        for test_name in performance_tests:
            test_file = self.test_dir / 'performance' / test_name
            if test_file.exists():
                self.run_test_file(test_file, 'performance')
    
    def setup_test_environment(self):
        """Set up test environment variables and checks."""
        print("🔧 Setting up test environment...")
        
        # Set environment variables
        os.environ['DJANGO_SETTINGS_MODULE'] = 'nexus8.settings'
        os.environ['DEBUG'] = 'True'
        os.environ['ENABLE_QUERY_LOGGING'] = 'False'  # Disable for accurate timing
        
        # Check Django setup
        try:
            import django
            django.setup()
            print("✅ Django environment configured")
        except Exception as e:
            print(f"❌ Django setup failed: {e}")
            return False
        
        return True

def main():
    parser = argparse.ArgumentParser(description='Nexus8 Test Runner')
    parser.add_argument('--category', choices=['performance', 'integration', 'api', 'cg_production'],
                      help='Run tests for specific category only')
    parser.add_argument('--benchmark', action='store_true',
                      help='Run performance benchmark suite')
    parser.add_argument('--setup-only', action='store_true',
                      help='Only setup test environment, don\'t run tests')
    
    args = parser.parse_args()
    
    runner = Nexus8TestRunner()
    
    # Setup test environment
    if not runner.setup_test_environment():
        print("❌ Failed to setup test environment")
        sys.exit(1)
    
    if args.setup_only:
        print("✅ Test environment setup complete")
        return
    
    if args.benchmark:
        runner.run_performance_benchmark()
    elif args.category:
        runner.run_category_tests(args.category)
    else:
        runner.run_all_tests()

if __name__ == '__main__':
    main()
