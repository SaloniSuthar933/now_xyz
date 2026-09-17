import { Router } from 'express';
import Notification from '../models/Notification.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const items = await Notification.find({ createdBy: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (error) {
    res.status(500).json({ message: 'Could not load outbox', error: error.message });
  }
});

export default router;
