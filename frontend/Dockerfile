FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Expose port 3000
EXPOSE 3000

# Run the development server with hot reload
CMD ["npm", "run", "dev"]
