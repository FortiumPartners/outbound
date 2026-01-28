"""
StateScoop Scout - Main entry point.

Monitors StateScoop RSS feed for executive moves in state/local government technology.

Usage:
    python3 -m src.main
"""

import asyncio
import logging
import sys
from datetime import datetime

from .article_parser import fetch_article_content
from .config import get_settings
from .entity_extractor import extract_entities
from .outbound_client import OutboundClient
from .rss_fetcher import fetch_rss_feed

# Configure logging
def setup_logging(level: str = "INFO") -> None:
    """Configure logging with timestamp and level."""
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


logger = logging.getLogger(__name__)


async def run_scout() -> dict:
    """Run the StateScoop scout.

    Returns:
        Summary dict with counts of articles processed and signals created
    """
    settings = get_settings()
    setup_logging(settings.log_level)

    logger.info("=" * 60)
    logger.info("StateScoop Scout starting")
    logger.info(f"  Feed URL: {settings.rss_feed_url}")
    logger.info(f"  Lookback: {settings.lookback_days} days")
    logger.info(f"  Dry run: {settings.dry_run}")
    logger.info("=" * 60)

    summary = {
        "started_at": datetime.utcnow().isoformat(),
        "articles_found": 0,
        "articles_processed": 0,
        "entities_extracted": 0,
        "signals_created": 0,
        "signals_skipped": 0,
        "errors": [],
    }

    try:
        # Step 1: Fetch RSS feed
        logger.info("Step 1: Fetching RSS feed...")
        items = await fetch_rss_feed(
            feed_url=settings.rss_feed_url,
            lookback_days=settings.lookback_days,
        )
        summary["articles_found"] = len(items)
        logger.info(f"Found {len(items)} relevant articles")

        if not items:
            logger.info("No relevant articles found. Exiting.")
            return summary

        # Step 2: Process each article
        async with OutboundClient(
            base_url=settings.outbound_api_url,
            api_key=settings.outbound_api_key,
            dry_run=settings.dry_run,
        ) as client:
            for i, item in enumerate(items, 1):
                logger.info(f"\nProcessing article {i}/{len(items)}: {item.title}")

                try:
                    # Step 2a: Fetch full article content (optional)
                    article_text = ""
                    if settings.fetch_full_article:
                        article_text = await fetch_article_content(item.link)
                        # Rate limiting
                        await asyncio.sleep(settings.rate_limit_ms / 1000)

                    # Fall back to description if full fetch failed
                    if not article_text:
                        article_text = item.description or ""

                    summary["articles_processed"] += 1

                    # Step 2b: Extract entities via Claude API
                    entity = await extract_entities(
                        title=item.title,
                        article_text=article_text,
                        api_key=settings.anthropic_api_key,
                    )

                    if not entity:
                        logger.warning(f"Failed to extract entities from: {item.title}")
                        summary["errors"].append(f"Entity extraction failed: {item.title}")
                        continue

                    summary["entities_extracted"] += 1
                    logger.info(
                        f"Extracted: {entity.person_name} - {entity.move_type.value} - {entity.organization}"
                    )

                    # Step 2c: Create signal
                    signal = await client.create_signal(item, entity)

                    if signal:
                        if signal.id == "dry-run":
                            summary["signals_skipped"] += 1
                        else:
                            summary["signals_created"] += 1
                    else:
                        summary["signals_skipped"] += 1

                except Exception as e:
                    logger.error(f"Error processing article {item.title}: {e}")
                    summary["errors"].append(f"Processing error: {item.title} - {str(e)}")

    except Exception as e:
        logger.error(f"Scout failed with error: {e}")
        summary["errors"].append(f"Fatal error: {str(e)}")

    summary["finished_at"] = datetime.utcnow().isoformat()

    # Print summary
    logger.info("\n" + "=" * 60)
    logger.info("Scout run complete!")
    logger.info(f"  Articles found: {summary['articles_found']}")
    logger.info(f"  Articles processed: {summary['articles_processed']}")
    logger.info(f"  Entities extracted: {summary['entities_extracted']}")
    logger.info(f"  Signals created: {summary['signals_created']}")
    logger.info(f"  Signals skipped: {summary['signals_skipped']}")
    if summary["errors"]:
        logger.warning(f"  Errors: {len(summary['errors'])}")
    logger.info("=" * 60)

    return summary


def main() -> None:
    """Main entry point."""
    try:
        asyncio.run(run_scout())
    except KeyboardInterrupt:
        logger.info("Scout interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Scout failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
