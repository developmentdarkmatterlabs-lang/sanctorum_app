import type { NextApiRequest, NextApiResponse } from 'next';

// OAuth authorize redirect. Build the provider consent URL here.
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(501).json({ error: 'Not implemented' });
}
