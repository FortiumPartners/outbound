"""
Outbound API client for creating signals.

Handles signal creation and deduplication checks.
"""

import logging

import httpx

from .models import (
    ExtractedEntity,
    RSSItem,
    Signal,
    SignalPayload,
    Severity,
    get_severity_for_move,
)

logger = logging.getLogger(__name__)


class OutboundClient:
    """Client for interacting with the Outbound API."""

    def __init__(
        self,
        base_url: str = "http://localhost:8004",
        api_key: str | None = None,
        dry_run: bool = False,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.dry_run = dry_run
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "OutboundClient":
        """Async context manager entry."""
        self._client = httpx.AsyncClient(timeout=30.0)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        if self._client:
            await self._client.aclose()
            self._client = None

    def _get_headers(self) -> dict[str, str]:
        """Build request headers."""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def check_signal_exists(self, source_id: str) -> bool:
        """Check if a signal with this sourceId already exists.

        Args:
            source_id: The sourceId to check

        Returns:
            True if signal exists, False otherwise
        """
        if not self._client:
            raise RuntimeError("Client not initialized. Use async context manager.")

        try:
            # Fetch signals and filter client-side (API doesn't filter by sourceId)
            response = await self._client.get(
                f"{self.base_url}/api/v1/signals",
                params={"limit": 1000},
                headers=self._get_headers(),
            )

            if response.is_success:
                data = response.json()
                signals = data if isinstance(data, list) else data.get("data", [])
                return any(s.get("sourceId") == source_id for s in signals)

            return False
        except Exception as e:
            logger.warning(f"Failed to check signal existence: {e}")
            return False

    def _build_source_id(self, guid: str) -> str:
        """Build sourceId from article GUID.

        Format: statescoop:article:{guid}
        """
        return f"statescoop:article:{guid}"

    def _build_signal_payload(
        self,
        item: RSSItem,
        entity: ExtractedEntity,
    ) -> dict:
        """Build the signal payload for the API.

        Args:
            item: RSS feed item
            entity: Extracted entity data

        Returns:
            Dict ready for JSON serialization
        """
        severity = get_severity_for_move(entity.move_type)
        source_id = self._build_source_id(item.guid)

        # Build summary
        if entity.new_title:
            summary = f"{entity.person_name} {entity.move_type.value} as {entity.new_title} - {entity.organization}"
        else:
            summary = f"{entity.person_name} {entity.move_type.value} from {entity.organization}"

        payload = {
            "type": "executive_move",
            "source": "statescoop",
            "sourceId": source_id,
            "severity": severity.value,
            "confidence": 0.85,
            "summary": summary,
            "rawPayload": {
                "articleTitle": item.title,
                "articleAuthor": item.author,
                "publishedDate": item.pub_date.isoformat() if item.pub_date else None,
                "personName": entity.person_name,
                "newTitle": entity.new_title,
                "organization": entity.organization,
                "organizationType": entity.organization_type.value if entity.organization_type else None,
                "moveType": entity.move_type.value,
                "previousRole": entity.previous_role,
                "effectiveDate": entity.effective_date,
                "replacementName": entity.replacement_name,
                "additionalContext": entity.additional_context,
            },
        }

        # Only include sourceUrl if valid
        if item.link and item.link.startswith("http"):
            payload["sourceUrl"] = item.link

        return payload

    async def create_signal(
        self,
        item: RSSItem,
        entity: ExtractedEntity,
    ) -> Signal | None:
        """Create a new signal in Outbound.

        Args:
            item: RSS feed item
            entity: Extracted entity data

        Returns:
            Created Signal if successful, None otherwise
        """
        if not self._client:
            raise RuntimeError("Client not initialized. Use async context manager.")

        source_id = self._build_source_id(item.guid)

        # Check for duplicates
        if await self.check_signal_exists(source_id):
            logger.info(f"Signal already exists, skipping: {source_id}")
            return None

        payload = self._build_signal_payload(item, entity)

        if self.dry_run:
            logger.info(
                f"DRY RUN: Would create signal: {source_id} "
                f"({entity.person_name} - {entity.organization})"
            )
            return Signal(
                id="dry-run",
                type="executive_move",
                source="statescoop",
                source_id=source_id,
            )

        try:
            response = await self._client.post(
                f"{self.base_url}/api/v1/signals",
                json=payload,
                headers=self._get_headers(),
            )

            if not response.is_success:
                logger.error(
                    f"Failed to create signal: {response.status_code} {response.text}"
                )
                return None

            data = response.json()
            logger.info(
                f"Created signal: {source_id} "
                f"({entity.person_name} - {entity.organization}) -> {data.get('id')}"
            )

            return Signal(
                id=data.get("id", ""),
                type=data.get("type", "executive_move"),
                source=data.get("source", "statescoop"),
                source_id=data.get("sourceId", source_id),
            )

        except Exception as e:
            logger.error(f"Failed to create signal: {e}")
            return None
