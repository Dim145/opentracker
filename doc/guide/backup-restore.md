# Backup & Restore

This guide covers backing up your Trackarr database and restoring it on a new server.

## Why Backup?

::: warning Critical
It is **strongly recommended** to back up your PostgreSQL database to **multiple locations**. If a node fails, having backups in different locations (off-site storage, cloud providers, separate servers) ensures you can recover your data.
:::

## Backup Strategy

- **Regular automated backups** — Set up daily or hourly `pg_dump` backups
- **Multiple destinations** — Store copies on at least 2-3 different locations
- **Test your restores** — Periodically verify that backups can be restored successfully
- **Encrypt backups** — Always encrypt backups before storing them off-site

### Creating a Database Backup

```bash
cd /opt/trackarr
docker compose exec postgres pg_dump -U tracker trackarr | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Backing Up Secrets

::: danger Don't forget your .env file
Your `.env` file contains critical secrets that **cannot be regenerated**. If you lose these, all existing passkeys and user sessions will be invalidated.
:::

Always back up your `.env` file alongside your database:

```bash
cd /opt/trackarr
cp .env .env.backup_$(date +%Y%m%d_%H%M%S)
```

Key secrets to preserve:

| Variable                  | Purpose                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `IP_HASH_SECRET`          | Hashes peer IPs in the tracker — losing this breaks peer tracking continuity but doesn't compromise security                   |
| `NUXT_SESSION_SECRET`     | Encrypts sessions and (as fallback) notification-channel configs — losing this logs out all users and breaks every channel row |
| `CHANNEL_ENCRYPTION_KEY`  | Optional dedicated key for notification-channel configs. When set, this is the variable that must survive the move (not the session secret). |

Store a copy of your `.env` file in a secure location (password manager, encrypted storage) separate from your database backups.

## Restoring a Backup

To restore your database on a new VPS:

**1. Install Trackarr on the new server**

Follow [Getting Started](/guide/getting-started) to install Docker, clone the repo,
configure `.env`, and start the production stack.

**2. Stop the application**

```bash
cd /opt/trackarr
docker compose -f docker-compose.prod.yml down
```

**3. Transfer your backup file to the new server**

```bash
# From your old server or local machine
scp backup_20260102_120000.sql.gz user@new-server:/opt/trackarr/
```

**4. Start only the database container**

```bash
cd /opt/trackarr
docker compose -f docker-compose.prod.yml up -d db
```

**5. Restore the backup**

```bash
# Drop and recreate the database
docker compose exec postgres dropdb -U tracker trackarr
docker compose exec postgres createdb -U tracker trackarr

# Restore from backup
gunzip -c backup_20260102_120000.sql.gz | docker compose exec -T db psql -U tracker trackarr
```

**6. Start all services**

```bash
docker compose -f docker-compose.prod.yml up -d
```

::: tip
Make sure to update your `.env` file on the new server with the same secrets (`IP_HASH_SECRET`, `NUXT_SESSION_SECRET`, `CHANNEL_ENCRYPTION_KEY` if set) from your old installation. Without them the existing session cookies invalidate at the next login and every encrypted notification-channel config becomes unreadable.
:::

## Changing Domains

If you're migrating to a new domain (e.g., `old-tracker.com` → `new-tracker.com`):

**1. Update DNS records**

Create A records for your new domain pointing to your server's IP:

| Subdomain                | Record Type | Value       |
| ------------------------ | ----------- | ----------- |
| `new-domain.com`         | A           | Your VPS IP |
| `tracker.new-domain.com` | A           | Your VPS IP |

**2. Update environment variables**

Edit your `.env` file:

```bash
cd /opt/trackarr
nano .env
```

Update these values:

```env
DOMAIN=new-domain.com
NUXT_PUBLIC_SITE_URL=https://tracker.new-domain.com
NUXT_PUBLIC_ANNOUNCE_URL=https://announce.new-domain.com
```

**3. Regenerate SSL certificates**

Delete the old Caddy data to force new certificate generation:

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm caddy_data || true
docker compose -f docker-compose.prod.yml up -d
```

Caddy will automatically obtain new Let's Encrypt certificates for your new domains.

::: warning
Changing the announce URL will invalidate all existing `.torrent` files and magnet links. Users will need to re-download torrent files with the new announce URL.
:::
