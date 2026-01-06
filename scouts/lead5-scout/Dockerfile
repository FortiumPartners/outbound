# Lead5 Scout - TypeScript Agent for finding executive job postings
# Using official Playwright Docker image for guaranteed compatibility
FROM mcr.microsoft.com/playwright:v1.49.1-noble

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json* ./

# Install dependencies (Playwright already installed in base image)
RUN npm install

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Run the scout
CMD ["node", "dist/main.js"]
