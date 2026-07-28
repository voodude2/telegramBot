FROM node:20-alpine

# Set working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies (using npm install since package-lock might not be fully synced, but production-only)
RUN npm install --only=production

# Copy the rest of the application code
COPY . .

# Expose the port your Express server runs on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
