import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roleGuard';
import {
  getConversation, listConversations, reattributeMessage,
} from '../controllers/conversationController';
import { sendMessage } from '../controllers/whatsappController';

const router = Router();
router.use(requireAuth);

// Reading is role-scoped inside the controllers: an Employee sees only their
// own conversation, so they can view the Tracker without being able to read
// anyone else's thread.
router.get('/', asyncRoute(listConversations));
router.get('/:userId/messages', asyncRoute(getConversation));

// Sending and correcting attribution stay Admin/Manager only.
router.post('/:userId/messages', requireRole('Admin', 'Manager'), asyncRoute((req, res) => {
  req.body.userId = req.params.userId;
  return sendMessage(req, res);
}));
router.patch('/messages/:id', requireRole('Admin', 'Manager'), asyncRoute(reattributeMessage));

export default router;
