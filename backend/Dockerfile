FROM node:16-alpine

# Install Docker CLI to communicate with host Docker
RUN apk add --no-cache docker-cli

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Run the app
CMD ["npm", "run", "dev"]