import { Router } from 'express';
import Batch from '../models/Batch.js';
import { requireAuth } from '../middleware/auth.js';
import { checkMedicineReorder } from '../services/notification.js';

const router = Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  try {
    const effectiveDate = new Date();
    effectiveDate.setHours(0, 0, 0, 0);
    const sevenDaysLater = new Date(effectiveDate);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
    const flagged = await Batch.updateMany({
      createdBy: req.user.id,
      status: { $in: ['active', null] },
      expiryDate: { $gte: effectiveDate, $lte: sevenDaysLater }
    }, { $set: { status: 'near-expiry' } });
    const quarantined = await Batch.updateMany({
      createdBy: req.user.id,
      status: { $in: ['active', 'near-expiry', null] },
      expiryDate: { $lt: effectiveDate }
    }, { $set: { status: 'quarantined' } });
    const medicines = await Batch.distinct('medicineName', { createdBy: req.user.id });
    await Promise.all(medicines.map(medicineName => checkMedicineReorder(req.user.id, medicineName)));
    res.json({ flagged: flagged.modifiedCount, quarantined: quarantined.modifiedCount });
  } catch (error) {
    res.status(500).json({ message: 'Could not advance clock', error: error.message });
  }
});

export default router;
