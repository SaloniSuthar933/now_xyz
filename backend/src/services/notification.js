import Notification from '../models/Notification.js';
import Batch from '../models/Batch.js';

function today() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function checkReorderAlert({ userId, medicineName, quantity, threshold }) {
  const dedupeKey = `${userId}:${medicineName.toLowerCase()}`;

  if (quantity < threshold) {
    try {
      return await Notification.findOneAndUpdate(
        { dedupeKey, resolvedAt: null },
        { $setOnInsert: {
          type: 'reorder',
          dedupeKey,
          medicineName,
          currentQuantity: quantity,
          threshold,
          reason: 'Usable stock is below the reorder threshold',
          createdBy: userId
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      return Notification.findOne({ dedupeKey, resolvedAt: null });
    }
  }

  const open = await Notification.findOne({ dedupeKey, resolvedAt: null });
  if (open) {
    open.resolvedAt = new Date();
    await open.save();
  }
  return null;
}

export async function checkMedicineReorder(userId, medicineName) {
  const matcher = new RegExp(`^${medicineName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i');
  const batches = await Batch.find({ createdBy: userId, medicineName: matcher }).lean();
  const usableQuantity = batches
    .filter(batch => batch.quantity > 0 && batch.expiryDate >= today() && ['active', 'near-expiry'].includes(batch.status))
    .reduce((sum, batch) => sum + batch.quantity, 0);
  const threshold = batches.length ? Math.min(...batches.map(batch => batch.reorderThreshold ?? 10)) : 10;
  return checkReorderAlert({ userId, medicineName, quantity: usableQuantity, threshold });
}