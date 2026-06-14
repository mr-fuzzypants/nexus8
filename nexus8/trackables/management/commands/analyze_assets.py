"""
Django management command to run AI analysis on MediaAsset objects.

Usage:
    python manage.py analyze_assets --all
    python manage.py analyze_assets --asset-ids 1,2,3
    python manage.py analyze_assets --media-type image
    python manage.py analyze_assets --force-reanalysis
"""

import asyncio
import logging
from asgiref.sync import async_to_sync
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from trackables.models import MediaAsset

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Run AI analysis on MediaAsset objects'

    def add_arguments(self, parser):
        parser.add_argument(
            '--all',
            action='store_true',
            help='Analyze all MediaAsset objects'
        )
        
        parser.add_argument(
            '--asset-ids',
            type=str,
            help='Comma-separated list of MediaAsset IDs to analyze'
        )
        
        parser.add_argument(
            '--media-type',
            type=str,
            help='Analyze assets of specific media type'
        )
        
        parser.add_argument(
            '--force-reanalysis',
            action='store_true',
            help='Force reanalysis of already processed assets'
        )
        
        parser.add_argument(
            '--batch-size',
            type=int,
            default=10,
            help='Number of assets to process in each batch (default: 10)'
        )
        
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be analyzed without actually running analysis'
        )

    def handle(self, *args, **options):
        """Handle the command execution."""
        try:
            # Get the assets to analyze
            queryset = self.get_assets_queryset(options)
            
            if not queryset.exists():
                self.stdout.write(
                    self.style.WARNING('No assets found matching the criteria.')
                )
                return
            
            total_assets = queryset.count()
            self.stdout.write(f"Found {total_assets} assets to analyze.")

            if options['dry_run']:
                self.show_dry_run_results(queryset)
                return

            # Materialize before entering the async context — sync ORM calls
            # (count/slicing) are forbidden inside async_to_sync.
            assets = list(queryset)
            async_to_sync(self.analyze_assets_async)(
                assets,
                options['batch_size'],
                options['force_reanalysis']
            )
            
        except Exception as e:
            logger.error(f"Command failed: {str(e)}")
            raise CommandError(f"Analysis failed: {str(e)}")

    def get_assets_queryset(self, options):
        """Get the queryset of assets to analyze based on options."""
        queryset = MediaAsset.objects.all()
        
        if options['asset_ids']:
            asset_ids = [int(id.strip()) for id in options['asset_ids'].split(',')]
            queryset = queryset.filter(id__in=asset_ids)
        
        elif options['media_type']:
            queryset = queryset.filter(type_data__media_type=options['media_type'])
        
        elif not options['all']:
            # Default: only analyze pending assets
            queryset = queryset.filter(ai_analysis_status='pending')
        
        return queryset.select_related().order_by('id')

    def show_dry_run_results(self, queryset):
        """Show what would be analyzed in dry run mode."""
        self.stdout.write(self.style.SUCCESS("DRY RUN - Assets that would be analyzed:"))
        self.stdout.write("-" * 60)
        
        for asset in queryset[:20]:  # Show first 20
            status_color = self.style.WARNING if asset.ai_analysis_status == 'pending' else self.style.SUCCESS
            self.stdout.write(
                f"ID: {asset.id:4d} | {asset.code:20s} | {asset.media_type:15s} | "
                f"Status: {status_color(asset.ai_analysis_status.ljust(10))} | {asset.file_path}"
            )
        
        if queryset.count() > 20:
            self.stdout.write(f"... and {queryset.count() - 20} more assets.")

    async def analyze_assets_async(self, assets, batch_size=10, force_reanalysis=False):
        """Asynchronously analyze assets in batches."""
        total_assets = len(assets)
        processed = 0
        successful = 0
        failed = 0

        self.stdout.write(f"Starting analysis of {total_assets} assets...")

        # Process in batches
        for i in range(0, total_assets, batch_size):
            batch = assets[i:i + batch_size]
            
            self.stdout.write(f"Processing batch {i//batch_size + 1}: assets {i+1}-{min(i+batch_size, total_assets)}")
            
            # Process batch
            batch_results = await self.process_batch(batch, force_reanalysis)
            
            successful += batch_results['successful']
            failed += batch_results['failed']
            processed += len(batch)
            
            # Progress update
            progress = (processed / total_assets) * 100
            self.stdout.write(f"Progress: {progress:.1f}% ({processed}/{total_assets})")
        
        # Final summary
        self.stdout.write("-" * 60)
        self.stdout.write(
            self.style.SUCCESS(f"Analysis complete! Processed: {processed}, Successful: {successful}, Failed: {failed}")
        )

    async def process_batch(self, assets_batch, force_reanalysis=False):
        """Process a batch of assets concurrently."""
        successful = 0
        failed = 0
        
        # Pair each pending asset with its coroutine so reporting can't
        # misalign when already-completed assets are skipped.
        pending = [
            asset
            for asset in assets_batch
            if asset.ai_analysis_status != 'completed' or force_reanalysis
        ]
        if not pending:
            return {'successful': 0, 'failed': 0}

        for i, asset in enumerate(pending):
            if i > 0:
                await asyncio.sleep(1)  # 1 second delay between requests

            try:
                result = await self.analyze_single_asset(asset, force_reanalysis)
                if result:
                    successful += 1
                    self.stdout.write(f"  ✓ {asset.code}")
                else:
                    failed += 1
                    self.stdout.write(f"  ✗ {asset.code}")
            except Exception as e:
                failed += 1
                logger.error(f"Failed to analyze {asset.code}: {str(e)}")
                self.stdout.write(f"  ✗ {asset.code} - {str(e)}")

        return {'successful': successful, 'failed': failed}

    async def analyze_single_asset(self, asset, force_reanalysis=False):
        """Analyze a single asset."""
        try:
            # Skip if no file path
            if not asset.file_path:
                asset.ai_analysis_status = 'skipped'
                await asset.asave()
                return False
            
            # Perform AI analysis
            analysis_results = await asset.perform_ai_analysis(force_reanalysis)
            
            if analysis_results:
                logger.info(f"Successfully analyzed asset {asset.code}")
                return True
            else:
                logger.warning(f"No analysis results for asset {asset.code}")
                return False
                
        except Exception as e:
            logger.error(f"Error analyzing asset {asset.code}: {str(e)}")
            # Mark as failed
            asset.ai_analysis_status = 'failed'
            await asset.asave()
            return False
