# Client — Vercel Deploy

## Deploy Steps

1. Connect the **repo root** to Vercel (not `packages/client`).
2. Vercel will detect the root `vercel.json` automatically — no override needed.
3. Set the following environment variables in the Vercel dashboard:
   - `VITE_SERVER_WS_URL` — e.g. `wss://your-server.fly.dev`
   - `VITE_SERVER_HTTP_URL` — e.g. `https://your-server.fly.dev`
4. Deploy. The root `vercel.json` runs `bun install` from the repo root so workspace dependencies (`packages/crdt`) are resolved correctly before building the client.

## Why root deployment?

The client imports from `packages/crdt` (a workspace package). If Vercel's root is set to `packages/client`, it only installs that package's direct dependencies and cannot resolve the workspace sibling. Deploying from the repo root with `bun install` installs the full workspace first.
