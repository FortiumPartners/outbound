# Lead5 Scout - TypeScript Agent for finding executive job postings
# Using bookworm (not slim) for better Playwright compatibility
FROM node:20-bookworm

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Install Playwright with all system dependencies
# --with-deps installs browser + all required system libraries
RUN npx playwright install --with-deps chromium

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Run the scout
CMD ["node", "dist/main.js"]
