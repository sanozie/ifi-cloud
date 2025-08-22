import express, { Request, Response } from 'express';
import { createJob, getJob } from '@ifi/db';
import { JobStatus } from '@ifi/shared';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Create chat -> enqueue job
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { threadId, message, context } = req.body || {};

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ message: 'message is required' });
    }

    // Determine repo (optional context)
    const repo = (context && typeof context.repo === 'string' && context.repo.trim())
      ? context.repo
      : 'sanozie/ifi';

    // Create a queued job
    const job = await createJob({
      status: JobStatus.QUEUED,
      repo,
      branch: undefined,
    });

    // Minimal response expected by client
    return res.status(200).json({ jobId: job.id, reply: null });
  } catch (err) {
    console.error('POST /api/chat error:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Get job by id
app.get('/api/jobs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const job = await getJob(id);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }
    return res.status(200).json(job);
  } catch (err) {
    console.error('GET /api/jobs/:id error:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Default route
app.get('*', (_req: Request, res: Response) => {
  res.status(200).json({ message: 'IFI API' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API server running at http://0.0.0.0:${PORT}`);
});
