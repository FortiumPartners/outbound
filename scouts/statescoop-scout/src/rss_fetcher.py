"""
RSS feed fetcher for StateScoop.

Fetches and parses the RSS feed, filtering for relevant executive move articles.
"""

import logging
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import feedparser
import httpx

from .models import RSSItem

logger = logging.getLogger(__name__)

# Keywords that indicate executive roles
EXECUTIVE_KEYWORDS = [
    "CIO",
    "CTO",
    "CISO",
    "CDO",
    "CAO",
    "chief information",
    "chief technology",
    "chief security",
    "chief data",
    "chief analytics",
    "chief digital",
]

# Keywords that indicate job moves
MOVE_KEYWORDS = [
    "appoint",
    "named",
    "hired",
    "joins",
    "resign",
    "depart",
    "leave",
    "exit",
    "retire",
    "interim",
    "acting",
]

# Category that indicates personnel news
PERSONNEL_CATEGORY = "Personnel"


def is_relevant_article(item: RSSItem) -> bool:
    """Check if an RSS item is about an executive move.

    Matches on:
    1. Category contains "Personnel"
    2. Title contains executive keyword AND move keyword
    """
    title_lower = item.title.lower()
    categories_lower = [c.lower() for c in item.categories]

    # Check for Personnel category
    has_personnel_category = any("personnel" in c for c in categories_lower)

    # Check for executive keywords in title
    has_executive_keyword = any(
        kw.lower() in title_lower for kw in EXECUTIVE_KEYWORDS
    )

    # Check for move keywords in title
    has_move_keyword = any(kw.lower() in title_lower for kw in MOVE_KEYWORDS)

    # Match if: has Personnel category, OR has both executive AND move keywords
    if has_personnel_category and (has_executive_keyword or has_move_keyword):
        return True
    if has_executive_keyword and has_move_keyword:
        return True

    return False


def parse_pub_date(date_str: str | None) -> datetime | None:
    """Parse RSS pubDate string to datetime."""
    if not date_str:
        return None
    try:
        return parsedate_to_datetime(date_str)
    except (ValueError, TypeError):
        logger.warning(f"Failed to parse date: {date_str}")
        return None


def parse_feed_item(entry: dict) -> RSSItem:
    """Convert feedparser entry to RSSItem model."""
    return RSSItem(
        title=entry.get("title", ""),
        link=entry.get("link", ""),
        guid=entry.get("id", entry.get("link", "")),
        author=entry.get("author", entry.get("dc_creator")),
        pub_date=parse_pub_date(entry.get("published")),
        categories=[tag.get("term", "") for tag in entry.get("tags", [])],
        description=entry.get("summary", ""),
        post_id=entry.get("post-id"),
    )


async def fetch_rss_feed(
    feed_url: str,
    lookback_days: int = 7,
    timeout: float = 30.0,
) -> list[RSSItem]:
    """Fetch and parse the StateScoop RSS feed.

    Args:
        feed_url: URL of the RSS feed
        lookback_days: Only return items from the last N days
        timeout: HTTP request timeout in seconds

    Returns:
        List of relevant RSSItem objects
    """
    logger.info(f"Fetching RSS feed: {feed_url}")

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(feed_url)
        response.raise_for_status()

    # Parse the RSS feed
    feed = feedparser.parse(response.text)

    if feed.bozo:
        logger.warning(f"Feed parsing warning: {feed.bozo_exception}")

    # Calculate cutoff date
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    items: list[RSSItem] = []
    for entry in feed.entries:
        item = parse_feed_item(entry)

        # Skip if too old
        if item.pub_date and item.pub_date < cutoff_date:
            logger.debug(f"Skipping old article: {item.title}")
            continue

        # Check relevance
        if is_relevant_article(item):
            logger.info(f"Found relevant article: {item.title}")
            items.append(item)
        else:
            logger.debug(f"Skipping irrelevant article: {item.title}")

    logger.info(f"Found {len(items)} relevant articles in the last {lookback_days} days")
    return items
