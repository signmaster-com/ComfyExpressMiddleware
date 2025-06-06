FROM node:20-alpine

WORKDIR /usr/src/app

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies
RUN npm install --omit=dev --no-optional

# Copy application files
COPY server.js .
COPY app.js .
COPY workflows.js .
COPY routes ./routes
COPY services ./services
COPY utils ./utils
COPY middleware ./middleware

# Set production environment
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]