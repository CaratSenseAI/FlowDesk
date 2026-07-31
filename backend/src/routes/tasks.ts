import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  setStatus,
  approveTask,
  rejectTask,
  retractApproval,
  escalateTask,
  reassignTask,
} from '../controllers/taskController';

const router = Router();

router.use(requireAuth);

router.get('/', asyncRoute(listTasks));
router.post('/', asyncRoute(createTask));
router.get('/:id', asyncRoute(getTask));
router.patch('/:id', asyncRoute(updateTask));
router.post('/:id/status', asyncRoute(setStatus));
router.post('/:id/approve', asyncRoute(approveTask));
router.post('/:id/retract', asyncRoute(retractApproval));
router.post('/:id/reject', asyncRoute(rejectTask));
router.post('/:id/escalate', asyncRoute(escalateTask));
router.post('/:id/reassign', asyncRoute(reassignTask));

export default router;
