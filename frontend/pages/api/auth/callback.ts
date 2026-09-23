import type { NextApiRequest, NextApiResponse } from 'next';

// Auth callback landing route. Wire up the provider exchange here.
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(501).json({ error: 'Not implemented' });
}
