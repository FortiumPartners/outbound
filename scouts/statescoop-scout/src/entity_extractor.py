"""
Entity extraction using Claude API.

Uses Claude Haiku to extract structured data from article text.
"""

import json
import logging

from anthropic import Anthropic

from .models import ExtractedEntity, MoveType, OrganizationType

logger = logging.getLogger(__name__)

# Claude model to use (Haiku for cost efficiency)
MODEL = "claude-3-haiku-20240307"

# Extraction prompt template
EXTRACTION_PROMPT = """You are extracting structured data from a news article about government technology leadership.

ARTICLE TITLE: {title}
ARTICLE TEXT: {article_text}

Extract the following fields. If not mentioned, use null.

{{
  "person_name": "Full name of the person",
  "new_title": "Their new title/role (or null if leaving)",
  "organization": "State/agency/department name",
  "organization_type": "state | county | city | agency",
  "move_type": "appointed | resigned | retired | interim | acting | promoted",
  "previous_role": "Their previous title if mentioned",
  "effective_date": "ISO date if mentioned, else null",
  "replacement_name": "Name of replacement if mentioned",
  "additional_context": "Brief summary of circumstances"
}}

Return ONLY valid JSON. No markdown formatting, no explanation."""


def parse_extraction_response(response_text: str) -> dict | None:
    """Parse the JSON response from Claude.

    Handles potential markdown code blocks and whitespace.
    """
    text = response_text.strip()

    # Remove markdown code block if present
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first line (```json or ```)
        lines = lines[1:]
        # Remove last line (```)
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON response: {e}")
        logger.debug(f"Response was: {response_text}")
        return None


def validate_move_type(value: str | None) -> MoveType | None:
    """Validate and convert move_type string to enum."""
    if not value:
        return None
    try:
        return MoveType(value.lower())
    except ValueError:
        logger.warning(f"Unknown move_type: {value}")
        return None


def validate_org_type(value: str | None) -> OrganizationType | None:
    """Validate and convert organization_type string to enum."""
    if not value:
        return None
    try:
        return OrganizationType(value.lower())
    except ValueError:
        logger.warning(f"Unknown organization_type: {value}")
        return None


async def extract_entities(
    title: str,
    article_text: str,
    api_key: str,
) -> ExtractedEntity | None:
    """Extract structured entities from article using Claude API.

    Args:
        title: Article title
        article_text: Full article text content
        api_key: Anthropic API key

    Returns:
        ExtractedEntity if successful, None otherwise
    """
    logger.info(f"Extracting entities from: {title}")

    # Truncate article text if too long (Haiku has 200k context but we want efficiency)
    max_chars = 8000
    if len(article_text) > max_chars:
        article_text = article_text[:max_chars] + "..."
        logger.debug(f"Truncated article text to {max_chars} chars")

    prompt = EXTRACTION_PROMPT.format(title=title, article_text=article_text)

    try:
        client = Anthropic(api_key=api_key)
        message = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        response_text = message.content[0].text
        logger.debug(f"Claude response: {response_text}")

        data = parse_extraction_response(response_text)
        if not data:
            return None

        # Validate required fields
        person_name = data.get("person_name")
        organization = data.get("organization")
        move_type = validate_move_type(data.get("move_type"))

        if not person_name or not organization or not move_type:
            logger.warning(
                f"Missing required fields: person_name={person_name}, "
                f"organization={organization}, move_type={move_type}"
            )
            return None

        return ExtractedEntity(
            person_name=person_name,
            new_title=data.get("new_title"),
            organization=organization,
            organization_type=validate_org_type(data.get("organization_type")),
            move_type=move_type,
            previous_role=data.get("previous_role"),
            effective_date=data.get("effective_date"),
            replacement_name=data.get("replacement_name"),
            additional_context=data.get("additional_context"),
        )

    except Exception as e:
        logger.error(f"Entity extraction failed: {e}")
        return None
