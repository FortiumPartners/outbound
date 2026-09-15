FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
# npm ci installs exactly what package-lock.json pins, so the image is the same
# every build. .dockerignore keeps the COPY below from overwriting this tree.
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Run the scout
CMD ["npm", "start"]
