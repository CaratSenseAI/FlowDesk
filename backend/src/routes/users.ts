import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roleGuard';
import { listUsers, createUser, updateUser, deleteUser } from '../controllers/userController';

const router = Router();

router.use(requireAuth);

router.get('/', asyncRoute(listUsers));
router.post('/', requireRole('Admin'), asyncRoute(createUser));
router.patch('/:id', asyncRoute(updateUser));
router.delete('/:id', requireRole('Admin'), asyncRoute(deleteUser));

export default router;
