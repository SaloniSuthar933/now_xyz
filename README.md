# PharmaFlow

PharmaFlow is a full-stack pharmacy stock manager built for a focused coding assessment. It tracks medicine batches, keeps expired stock out of sellable totals, and dispenses using FEFO (First Expiry, First Out).

## Structure

- `backend/` - Express REST API, Mongoose models, JWT authentication
- `frontend/` - React + Vite responsive web app

## Run locally

Prerequisites: Node.js 18+, MongoDB 6+ running locally or a MongoDB Atlas URI.

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Environment variables

Backend `.env`:

- `PORT` - API port, default `5000`
- `MONGO_URI` - MongoDB connection string
- `JWT_SECRET` - secret used to sign JWTs
- `CLIENT_URL` - frontend origin for CORS, default `http://localhost:5173`

Optional frontend variable: `VITE_API_URL` (defaults to same-origin `/api`; Vite proxies `/api`, `/clock`, and `/outbox` to `http://localhost:5000` during development).

## API endpoints

All protected endpoints require `Authorization: Bearer <token>`. Authentication endpoints and `GET /api/health` are public.

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/batches?search=&page=&limit=&sortBy=expiryDate|medicineName|quantity&order=asc|desc`
- `POST /api/batches`
- `POST /api/batches/import` with `{ "batches": [...] }`, returning `{ imported, deduped, rejected }`
- `GET /api/batches/:id`
- `PUT /api/batches/:id`
- `DELETE /api/batches/:id`
- `POST /api/batches/dispense` with `{ "medicineName": "...", "quantity": 5 }`
- `GET /api/batches/stock/:medicineName`
- `GET /api/batches/alerts`
- `POST /clock` to flag batches expiring within 7 days and quarantine expired batches
- `GET /outbox` to inspect open and resolved reorder notifications

Batch records include `status` (`active`, `near-expiry`, or `quarantined`) and `reorderThreshold`. Import accepts quantities such as `10 units`, ISO dates, and `dd/mm/yyyy` dates. Invalid rows are rejected without changing existing stock, and duplicate medicine/batch rows are counted as deduplicated.

## FEFO behavior

Sellable batches must have `quantity > 0`, an expiry date on or after the start of today, and an `active` or `near-expiry` status. Quarantined and expired batches are never eligible. Dispensing first calculates the total eligible quantity and rejects the request without changing stock when it is insufficient. It then sorts eligible batches by expiry ascending and atomically decrements each batch conditionally, rolling back prior decrements if a concurrent stock change is detected. The response includes the batch-by-batch breakdown.

## Testing manually

1. Start MongoDB, API, and frontend.
2. Register a user in the landing page.
3. Add two batches for the same medicine with different expiry dates, plus an expired batch.
4. Confirm the dashboard sellable total excludes the expired batch.
5. Use **Dispense stock** for a quantity spanning both in-date batches; confirm the earlier expiry is consumed first.
6. Try dispensing more than available; confirm the API returns an error and quantities remain unchanged.
7. Test search, sort direction, pagination, edit, delete, and the 30-day expiry watchlist.
