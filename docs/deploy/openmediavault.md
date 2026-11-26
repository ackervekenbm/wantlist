# OpenMediaVault (Compose plugin)

Part of the [deployment guides](README.md).

The prebuilt image, run from OMV's web UI. This is the reference setup.

## What you need

- omv-extras with the **`openmediavault-compose`** plugin, and the plugin's
  *Compose Files* and *Data* shared folders set in **Services → Compose →
  Settings**.
- A 64-bit OMV install ([why](README.md#the-contract-every-route-shares)).
- The two [API keys](README.md#two-free-api-keys).

## Create the stack

1. **Services → Compose → Files → Create** (`+`).
2. **Name**: `wantlist` (a stack name, not a filename).
3. **File**: paste

   ```yaml
   services:
     wantlist:
       image: ghcr.io/ackervekenbm/wantlist:latest
       ports:
         - "8091:3000"
       environment:
         GEMINI_API_KEY: ${GEMINI_API_KEY:?set GEMINI_API_KEY in Environment}
         SERPER_API_KEY: ${SERPER_API_KEY:?set SERPER_API_KEY in Environment}
         # Optional: blank uses the app's default (operations.md#settings).
         GEMINI_MODEL: ${GEMINI_MODEL:-}
         MODEL_CHAIN: ${MODEL_CHAIN:-}
         GROQ_API_KEY: ${GROQ_API_KEY:-}
         GROQ_MODEL: ${GROQ_MODEL:-}
         OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:-}
         OPENROUTER_MODEL: ${OPENROUTER_MODEL:-}
         WORKER_INTERVAL_MS: ${WORKER_INTERVAL_MS:-}
         WORKER_QUEUE_CAP: ${WORKER_QUEUE_CAP:-}
         PARTNER_PROGRAMS: ${PARTNER_PROGRAMS:-}
       volumes:
         - CHANGE_TO_COMPOSE_DATA_PATH/wantlist-data:/app/data
       logging:
         driver: json-file
         options:
           max-size: "10m"
           max-file: "3"
       restart: unless-stopped
   ```

4. **Environment**: the two keys, one per line, no quotes. Add any optional
   [setting](operations.md#settings) only to change it.

   ```bash
   GEMINI_API_KEY=...
   SERPER_API_KEY=...
   ```

5. **Save**, select the entry, **Up**. Open `http://<server-ip>:8091`.

Verify: **Services → Compose → Services** shows the container running (and
healthy after half a minute), and `http://<server-ip>:8091/api/health`
returns `{"ok":true}`.

## What the file does

- **`CHANGE_TO_COMPOSE_DATA_PATH/wantlist-data`**: the plugin fills in the
  *Data* shared folder's path, so `<Data folder>/wantlist-data/wantlist.db` is
  the whole server-side state: an ordinary folder you can browse, copy and back
  up, which **Prune → Volume** can't delete.
- **Ownership is automatic.** The app runs as the unprivileged user uid 1000.
  Each time the container starts it gives `wantlist-data` and the files in it
  to that user, also a folder an older image or a restore left owned by root.
  Nothing to set up and no SSH needed. The folder must sit on a Linux
  filesystem (ext4, btrfs, xfs, what OMV formats with): NTFS, exFAT and FAT
  can't store an owner, and the app then can't open its database.
- **Port `8091`**: any free host port works; change the left-hand number only.
  Behind a [reverse proxy](https.md) on the same Docker network you can drop
  `ports:` altogether.
- **No `container_name`**: compose names it `wantlist-wantlist-1`.
- **`logging`**: caps the container log at 30 MB, so it can't fill the disk.
- **The settings are listed, not commented out.** Compose only passes a value
  from the Environment box into the container when the file names it.

## Updating

Select the stack → **Pull** → **Up**. An unchanged image is a no-op; the data
folder is untouched either way. Pinning a version and rolling back:
[operations.md](operations.md#rollback).

## Backups

A **Services → Compose → Schedule** job with *Backup* enabled stops the
container, copies the data folder and starts it again. What to copy and why
the container must be stopped: [operations.md](operations.md#backups).

## Logs

**Services → Compose → Services** → the container → **Logs**.

## Next

- [https.md](https.md): a host name and HTTPS
- [operations.md](operations.md): settings, backups
- [troubleshooting.md](troubleshooting.md): when something doesn't work
- Back to the overview: [README.md](README.md)
