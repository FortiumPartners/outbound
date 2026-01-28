"""
Article content parser for StateScoop.

Fetches full article HTML and extracts main content text.
"""

import logging
import re

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


def clean_text(text: str) -> str:
    """Clean extracted text by normalizing whitespace."""
    # Replace multiple whitespace with single space
    text = re.sub(r"\s+", " ", text)
    # Remove leading/trailing whitespace
    text = text.strip()
    return text


def extract_article_content(html: str) -> str:
    """Extract main article content from HTML.

    Uses BeautifulSoup to find the article body and strip
    navigation, ads, sidebars, and other non-content elements.
    """
    soup = BeautifulSoup(html, "lxml")

    # Remove unwanted elements
    for element in soup.find_all(
        ["script", "style", "nav", "header", "footer", "aside", "iframe", "noscript"]
    ):
        element.decompose()

    # Remove elements by class/id patterns (common ad/sidebar indicators)
    unwanted_patterns = [
        "sidebar",
        "advertisement",
        "ad-",
        "social",
        "share",
        "related",
        "comment",
        "newsletter",
        "popup",
        "modal",
    ]
    for pattern in unwanted_patterns:
        for element in soup.find_all(
            class_=lambda x: x and pattern in str(x).lower()
        ):
            element.decompose()
        for element in soup.find_all(id=lambda x: x and pattern in str(x).lower()):
            element.decompose()

    # Try to find the main article content
    # StateScoop uses WordPress, common article selectors:
    content = None

    # Try article-specific selectors first
    selectors = [
        ("article", {"class_": "post"}),
        ("div", {"class_": "entry-content"}),
        ("div", {"class_": "post-content"}),
        ("div", {"class_": "article-content"}),
        ("article", {}),
        ("main", {}),
    ]

    for tag, attrs in selectors:
        content = soup.find(tag, **attrs)
        if content:
            break

    # Fallback to body if no article container found
    if not content:
        content = soup.find("body")

    if not content:
        logger.warning("Could not find article content, returning empty string")
        return ""

    # Extract text
    text = content.get_text(separator=" ")
    return clean_text(text)


async def fetch_article_content(
    url: str,
    timeout: float = 30.0,
) -> str:
    """Fetch and parse a full article from its URL.

    Args:
        url: Article URL
        timeout: HTTP request timeout in seconds

    Returns:
        Extracted article text content
    """
    logger.info(f"Fetching full article: {url}")

    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; StateScoopScout/1.0; +https://fortium.io)",
                },
            )
            response.raise_for_status()

        content = extract_article_content(response.text)
        logger.debug(f"Extracted {len(content)} characters from article")
        return content

    except httpx.HTTPError as e:
        logger.error(f"Failed to fetch article {url}: {e}")
        return ""
    except Exception as e:
        logger.error(f"Error parsing article {url}: {e}")
        return ""
