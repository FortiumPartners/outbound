"""
Pydantic models for StateScoop Scout.

Defines data structures for RSS items, extracted entities, and signals.
"""

from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field


class MoveType(str, Enum):
    """Types of executive moves."""

    APPOINTED = "appointed"
    RESIGNED = "resigned"
    RETIRED = "retired"
    INTERIM = "interim"
    ACTING = "acting"
    PROMOTED = "promoted"


class OrganizationType(str, Enum):
    """Types of government organizations."""

    STATE = "state"
    COUNTY = "county"
    CITY = "city"
    AGENCY = "agency"


class Severity(str, Enum):
    """Signal severity levels based on move type."""

    HIGH = "high"  # resigned, retired, interim, acting
    MEDIUM = "medium"  # appointed
    LOW = "low"  # promoted


class RSSItem(BaseModel):
    """Parsed RSS feed item."""

    title: str
    link: str
    guid: str
    author: str | None = None
    pub_date: datetime | None = None
    categories: list[str] = Field(default_factory=list)
    description: str | None = None
    post_id: str | None = None


class ExtractedEntity(BaseModel):
    """Entity extracted from article via Claude API."""

    person_name: str
    new_title: str | None = None
    organization: str
    organization_type: OrganizationType | None = None
    move_type: MoveType
    previous_role: str | None = None
    effective_date: str | None = None  # ISO date string
    replacement_name: str | None = None
    additional_context: str | None = None


class SignalPayload(BaseModel):
    """Payload for creating a signal in Outbound API."""

    type: str = "executive_move"
    source: str = "statescoop"
    source_id: str = Field(alias="sourceId")
    source_url: str | None = Field(default=None, alias="sourceUrl")
    severity: Severity
    confidence: float = 0.85
    summary: str | None = None
    raw_payload: dict = Field(default_factory=dict, alias="rawPayload")

    model_config = {"populate_by_name": True}


class Signal(BaseModel):
    """Response from Outbound API after creating a signal."""

    id: str
    type: str
    source: str
    source_id: str = Field(alias="sourceId")
    created_at: datetime | None = Field(default=None, alias="createdAt")

    model_config = {"populate_by_name": True}


def get_severity_for_move(move_type: MoveType) -> Severity:
    """Determine signal severity based on move type.

    - HIGH: Immediate gap to fill (resigned, retired, interim, acting)
    - MEDIUM: New decision-maker (appointed)
    - LOW: Internal move (promoted)
    """
    high_priority = {MoveType.RESIGNED, MoveType.RETIRED, MoveType.INTERIM, MoveType.ACTING}
    if move_type in high_priority:
        return Severity.HIGH
    elif move_type == MoveType.PROMOTED:
        return Severity.LOW
    return Severity.MEDIUM
