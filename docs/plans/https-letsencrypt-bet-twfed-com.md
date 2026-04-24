# HTTPS setup for bet.twfed.com via Let's Encrypt

## Preconditions
- DNS `bet.twfed.com` points to this server (`178.236.244.53`) — already OK.
- Ports 80/443 are reachable from internet.

## Current server notes
- Port 80 and 443 are currently occupied by `caddy`.
- `certbot` is not installed.

## One-time issue command (root)
```bash
sudo apt update
sudo apt install -y certbot

# free :80 for standalone challenge
sudo systemctl stop caddy

# issue certificate
sudo certbot certonly --standalone \
  -d bet.twfed.com \
  --agree-tos \
  --register-unsafely-without-email

# optional: bring caddy back if you still need it
# sudo systemctl start caddy
```

Certificates will be created at:
- `/etc/letsencrypt/live/bet.twfed.com/fullchain.pem`
- `/etc/letsencrypt/live/bet.twfed.com/privkey.pem`

## Run tiger_bet with HTTPS
```bash
cd /home/fedulov/tiger_bet
HTTPS_ENABLE=1 \
HTTPS_DOMAIN=bet.twfed.com \
DOMAIN=0.0.0.0 \
RUN_HTTP=1 RUN_BOT=1 RUN_SCHEDULER=0 \
node index.js
```

## Verify
```bash
curl -I https://bet.twfed.com/webapp
```

## Renewal
```bash
sudo certbot renew --dry-run
```

If service is managed via systemd/pm2, add restart after renew (deploy hook), e.g.:
```bash
sudo certbot renew --deploy-hook "systemctl restart tiger-bet"
```
