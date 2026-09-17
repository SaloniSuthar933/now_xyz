import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import authRoutes from './routes/auth.js';
import batchRoutes from './routes/batches.js';
import clockRoutes from './routes/clock.js';
import outboxRoutes from './routes/outbox.js';

dotenv.config({ path: new URL('../.env', import.meta.url) });

const app = express();
const port = process.env.PORT || 5000;
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/batches', batchRoutes);
app.use('/clock', clockRoutes);
app.use('/outbox', outboxRoutes);
app.use((error, _req, res, _next) => res.status(500).json({ message: error.message || 'Unexpected server error' }));

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pharmacy_stock_manager')
  .then(() => app.listen(port, () => console.log(`API listening on http://localhost:${port}`)))
  .catch((error) => { console.error('MongoDB connection failed:', error.message); process.exit(1); });
