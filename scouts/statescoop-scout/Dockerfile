# StateScoop Scout - Dockerfile
# Monitors state/local government tech executive moves via RSS

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies for lxml
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libxml2-dev \
        libxslt1-dev \
        gcc \
        python3-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY pyproject.toml ./

# Install Python dependencies
RUN pip install --no-cache-dir .

# Copy source code
COPY src/ ./src/

# Create non-root user for security
RUN useradd -m -u 1000 scout
USER scout

# Run the scout
CMD ["python3", "-m", "src.main"]
