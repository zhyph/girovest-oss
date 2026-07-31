import { Router } from 'express'
import { requireAuth } from '../auth/authMiddleware.js'
import { createDatabaseSnapshot } from '../services/backupService.js'

export const backupRouter = Router()
backupRouter.use(requireAuth)

backupRouter.post('/snapshot', async (_req, res) => {
  const snapshotPath = await createDatabaseSnapshot()
  res.json({ path: snapshotPath })
})
