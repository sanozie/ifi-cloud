import express, { Request, Response } from 'express';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Middleware
app.use(express.json());

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Default route
app.get('*', (_req: Request, res: Response) => {
  res.status(200).json({ message: 'IFI API' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API server running at http://0.0.0.0:${PORT}`);
});
