FROM python:3.10-slim-bookworm

WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive

# System Dependencies
RUN apt-get update && apt-get install -y curl npm gnupg procps \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install cloudflared (for arm64)
# Install cloudflared (multi-arch)
ARG TARGETARCH
RUN if [ "$TARGETARCH" = "arm64" ]; then \
        curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb; \
    elif [ "$TARGETARCH" = "amd64" ]; then \
        curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb; \
    else \
        echo "Unsupported architecture: $TARGETARCH" && exit 1; \
    fi \
    && dpkg -i cloudflared.deb \
    && rm cloudflared.deb
# Install pm2 globally
RUN npm install -g pm2


# Copy all project code
COPY . .


RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        python3-dev \
        sed \
    && sed -i '/torch/d' requirements.txt \
    && pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir uvicorn \
    && apt-get purge -y build-essential python3-dev sed \
    && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
# Install Node.js dependencies and build the game
RUN cd racing-game && npm install && npm run build

# --- 4. Configure PM2 (Process Manager) ---
COPY ecosystem.config.js .

# --- 5. Run ---
# Expose the internal ports
EXPOSE 8765 8766 4173

# This API key MUST be passed in at runtime
ENV ELEVEN_API_KEY=""

# Start all services
CMD ["pm2-runtime", "start", "ecosystem.config.js"]