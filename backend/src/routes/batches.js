import { Router } from 'express';
import mongoose from 'mongoose';
import Batch from '../models/Batch.js';
import { requireAuth } from '../middleware/auth.js';
import { checkMedicineReorder } from '../services/notification.js';

const router = Router();
router.use(requireAuth);
const today = () => { const date = new Date(); date.setHours(0, 0, 0, 0); return date; };
const allowedSorts = { expiryDate: 'expiryDate', medicineName: 'medicineName', quantity: 'quantity' };
const usableFilter = () => ({ quantity: { $gt: 0 }, expiryDate: { $gte: today() }, status: { $in: ['active', 'near-expiry'] } });
const medicinePattern = medicineName => new RegExp(`^${medicineName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i');

function parseImportQuantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(?:units?)?$/i);
  if (!match) return null;
  const quantity = Number(match[1]);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}

function parseImportNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

function parseImportDate(value) {
  if (typeof value !== 'string') return null;
  let year; let month; let day;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const european = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (iso) [, year, month, day] = iso;
  else if (european) [, day, month, year] = european;
  else return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return date;
}

function importIdentity(record) {
  return `${record.medicineName.toLowerCase()}::${record.batchNumber.toLowerCase()}`;
}

router.get('/', async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 8, 1), 100);
    const sortBy = allowedSorts[req.query.sortBy] || 'expiryDate';
    const order = req.query.order === 'desc' ? -1 : 1;
    const filter = { createdBy: req.user.id };
    if (req.query.search?.trim()) filter.medicineName = { $regex: req.query.search.trim(), $options: 'i' };
    const [items, total] = await Promise.all([
      Batch.find(filter).sort({ [sortBy]: order, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Batch.countDocuments(filter)
    ]);
    const sellable = await Batch.aggregate([{ $match: { ...filter, ...usableFilter() } }, { $group: { _id: null, quantity: { $sum: '$quantity' }, batches: { $sum: 1 } } }]);
    res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) }, sellableStock: sellable[0] || { quantity: 0, batches: 0 } });
  } catch (error) { res.status(500).json({ message: 'Could not load batches', error: error.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { medicineName, batchNumber, quantity, expiryDate, unitPrice, reorderThreshold } = req.body;
    if (!medicineName || !batchNumber || quantity === undefined || !expiryDate || unitPrice === undefined) return res.status(400).json({ message: 'All batch fields are required' });
    const batch = await Batch.create({ medicineName, batchNumber, quantity, expiryDate, unitPrice, reorderThreshold, createdBy: req.user.id });
    await checkMedicineReorder(req.user.id, medicineName);
    res.status(201).json(batch);
  } catch (error) { res.status(400).json({ message: 'Could not create batch', error: error.message }); }
});

router.post('/import', async (req, res) => {
  const records = Array.isArray(req.body) ? req.body : req.body?.batches;
  if (!Array.isArray(records)) return res.status(400).json({ message: 'Expected a batches array' });
  let imported = 0; let deduped = 0; let rejected = 0;
  const seen = new Set();
  const importedMedicines = new Set();
  try {
    for (const record of records) {
      if (!record || typeof record !== 'object') { rejected += 1; continue; }
      const medicineName = typeof record.medicineName === 'string' ? record.medicineName.trim() : '';
      const batchNumber = typeof record.batchNumber === 'string' ? record.batchNumber.trim() : '';
      const quantity = parseImportQuantity(record.quantity);
      const expiryDate = parseImportDate(record.expiryDate);
      const unitPrice = parseImportNumber(record.unitPrice);
      const reorderThreshold = record.reorderThreshold === undefined || record.reorderThreshold === null ? 10 : parseImportNumber(record.reorderThreshold);
      if (!medicineName || !batchNumber || quantity === null || !expiryDate || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(reorderThreshold) || reorderThreshold < 0) { rejected += 1; continue; }
      const normalized = { medicineName, batchNumber, quantity, expiryDate, unitPrice, reorderThreshold };
      const identity = importIdentity(normalized);
      if (seen.has(identity) || await Batch.exists({ createdBy: req.user.id, medicineName: medicinePattern(medicineName), batchNumber: new RegExp(`^${batchNumber.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i') })) { deduped += 1; continue; }
      await Batch.create({ ...normalized, createdBy: req.user.id });
      seen.add(identity); importedMedicines.add(medicineName); imported += 1;
    }
    for (const medicineName of importedMedicines) await checkMedicineReorder(req.user.id, medicineName);
    res.json({ imported, deduped, rejected });
  } catch (error) { res.status(400).json({ message: 'Could not import batches', error: error.message }); }
});

router.get('/alerts', async (req, res) => {
  try {
    const now = today(); const inThirty = new Date(now); inThirty.setDate(inThirty.getDate() + 30);
    const items = await Batch.find({ createdBy: req.user.id, ...usableFilter(), expiryDate: { $gte: now, $lte: inThirty } }).sort({ expiryDate: 1 }).lean();
    res.json({ items });
  } catch (error) { res.status(500).json({ message: 'Could not load expiry alerts', error: error.message }); }
});

router.get('/stock/:medicineName', async (req, res) => {
  try {
    const items = await Batch.find({ createdBy: req.user.id, medicineName: medicinePattern(req.params.medicineName), ...usableFilter() }).sort({ expiryDate: 1 }).lean();
    res.json({ medicineName: req.params.medicineName, quantity: items.reduce((sum, item) => sum + item.quantity, 0), batches: items });
  } catch (error) { res.status(500).json({ message: 'Could not load stock', error: error.message }); }
});

router.get('/:id', async (req, res) => {
  try { const item = await Batch.findOne({ _id: req.params.id, createdBy: req.user.id }); if (!item) return res.status(404).json({ message: 'Batch not found' }); res.json(item); }
  catch (error) { res.status(400).json({ message: 'Invalid batch id' }); }
});

router.put('/:id', async (req, res) => {
  try { const item = await Batch.findOneAndUpdate({ _id: req.params.id, createdBy: req.user.id }, req.body, { new: true, runValidators: true }); if (!item) return res.status(404).json({ message: 'Batch not found' }); await checkMedicineReorder(req.user.id, item.medicineName); res.json(item); }
  catch (error) { res.status(400).json({ message: 'Could not update batch', error: error.message }); }
});

router.delete('/:id', async (req, res) => {
  try { const item = await Batch.findOneAndDelete({ _id: req.params.id, createdBy: req.user.id }); if (!item) return res.status(404).json({ message: 'Batch not found' }); await checkMedicineReorder(req.user.id, item.medicineName); res.json({ message: 'Batch deleted' }); }
  catch (error) { res.status(400).json({ message: 'Invalid batch id' }); }
});

router.post('/dispense', async (req, res) => {
  const { medicineName, quantity } = req.body;
  const requested = Number(quantity);
  if (!medicineName || !Number.isInteger(requested) || requested <= 0) return res.status(400).json({ message: 'Medicine name and a positive whole quantity are required' });
  try {
    const eligible = await Batch.find({ createdBy: req.user.id, medicineName: medicinePattern(medicineName), ...usableFilter() }).sort({ expiryDate: 1, _id: 1 });
    const available = eligible.reduce((sum, batch) => sum + batch.quantity, 0);
    if (available < requested) return res.status(409).json({ message: `Only ${available} sellable units are available; nothing was dispensed`, available });
    let remaining = requested; const breakdown = []; const changed = [];
    try {
      for (const batch of eligible) {
        if (!remaining) break;
        const used = Math.min(batch.quantity, remaining);
          const update = await Batch.updateOne({ _id: batch._id, createdBy: req.user.id, ...usableFilter(), quantity: { $gte: used } }, { $inc: { quantity: -used } });
        if (update.modifiedCount !== 1) throw new Error('Stock changed during dispensing; please try again');
        changed.push({ id: batch._id, used }); breakdown.push({ batchId: batch._id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, quantity: used }); remaining -= used;
      }
      if (remaining) throw new Error('Stock changed during dispensing; please try again');
    } catch (error) {
      await Promise.all(changed.map(({ id, used }) => Batch.updateOne({ _id: id }, { $inc: { quantity: used } })));
      return res.status(409).json({ message: error.message, rolledBack: true });
    }
    await checkMedicineReorder(req.user.id, medicineName);
    res.json({ message: 'Dispensed successfully', medicineName, quantity: requested, breakdown });
  } catch (error) { res.status(500).json({ message: 'Could not dispense medicine', error: error.message }); }
});

export default router;
