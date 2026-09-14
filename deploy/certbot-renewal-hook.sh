#!/bin/sh
# coturn doesn't hot-reload its TLS certificate, so after certbot renews the
# TURN domain's cert it needs a restart. Certbot runs every script under
# /etc/letsencrypt/renewal-hooks/deploy/ after ANY successful renewal
# (only run for the domain(s) that actually renewed, via $RENEWED_DOMAINS).
#
# Install:
#   sudo cp deploy/certbot-renewal-hook.sh /etc/letsencrypt/renewal-hooks/deploy/restart-coturn.sh
#   sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/restart-coturn.sh
#
# Adjust PROJECT_DIR below if you didn't deploy to /opt/zep-mini-mvp.

set -eu

PROJECT_DIR="/opt/zep-mini-mvp"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"
ENV_FILE="$PROJECT_DIR/server/.env.production"

case "${RENEWED_DOMAINS:-}" in
  *"$(grep -m1 '^TURN_DOMAIN=' "$ENV_FILE" | cut -d= -f2)"*)
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart coturn
    ;;
esac
