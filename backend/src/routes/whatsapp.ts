import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roleGuard';
import { sendMessage } from '../controllers/whatsappController';

const router = Router();
router.use(requireAuth);
router.use(requireRole('Admin', 'Manager'));
router.post('/send', sendMessage);

export default router;
